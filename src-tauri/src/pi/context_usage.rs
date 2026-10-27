use super::types::{ContextUsage, RuntimeSnapshot};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::Instant;
use uuid::Uuid;

struct Reading {
    id: String,
    revision: u64,
    instance_id: String,
    session_id: String,
    model: (String, String),
    deadline: Instant,
}

/// Usage is optional telemetry: coalesce reads and never let a missing reply
/// time out a working chat. Late replies cannot cross a session/model change.
#[derive(Default)]
pub struct ContextUsageReader {
    reading: Option<Reading>,
    revision: u64,
    dirty: bool,
    suspended: bool,
    session_transition: bool,
}

impl ContextUsageReader {
    pub fn invalidate(&mut self) {
        self.revision += 1;
        self.dirty = true;
    }

    pub fn suspend(&mut self) {
        self.invalidate();
        self.suspended = true;
    }

    pub fn resume(&mut self) {
        self.suspended = false;
        self.invalidate();
    }

    pub fn begin_session(&mut self) {
        self.session_transition = true;
        self.invalidate();
    }

    pub fn end_session(&mut self) {
        self.session_transition = false;
        self.resume();
    }

    pub fn expire(&mut self, now: Instant) {
        if self
            .reading
            .as_ref()
            .is_some_and(|reading| reading.deadline <= now)
        {
            self.reading = None;
        }
    }

    pub fn request(&mut self, snapshot: &RuntimeSnapshot) -> Option<Value> {
        if !self.dirty
            || self.suspended
            || self.session_transition
            || self.reading.is_some()
            || snapshot.session_id.is_empty()
        {
            return None;
        }
        let model = snapshot.model.as_ref()?;
        let id = Uuid::new_v4().to_string();
        self.reading = Some(Reading {
            id: id.clone(),
            revision: self.revision,
            instance_id: snapshot.instance_id.clone(),
            session_id: snapshot.session_id.clone(),
            model: (model.provider.clone(), model.id.clone()),
            deadline: Instant::now() + Duration::from_secs(5),
        });
        self.dirty = false;
        Some(json!({"type":"get_session_stats","id":id}))
    }

    pub fn response(
        &mut self,
        record: &Value,
        snapshot: &RuntimeSnapshot,
    ) -> Option<Option<ContextUsage>> {
        let reading = self.reading.as_ref()?;
        if record["id"] != reading.id {
            return None;
        }
        let reading = self.reading.take().unwrap();
        if reading.revision != self.revision
            || reading.instance_id != snapshot.instance_id
            || reading.session_id != snapshot.session_id
            || snapshot
                .model
                .as_ref()
                .map(|model| (&model.provider, &model.id))
                != Some((&reading.model.0, &reading.model.1))
        {
            return None;
        }
        // Failed/unsupported reads show unavailable without interrupting a run.
        Some(if record["success"] == true {
            parse_usage(&record["data"]["contextUsage"])
        } else {
            None
        })
    }
}

fn parse_usage(data: &Value) -> Option<ContextUsage> {
    let context_window = data["contextWindow"]
        .as_u64()
        .filter(|window| *window > 0)?;
    let (tokens, percent) = match (data["tokens"].as_u64(), data["percent"].as_f64()) {
        (Some(tokens), Some(percent)) if percent.is_finite() && percent >= 0.0 => {
            (Some(tokens), Some(percent))
        }
        _ => (None, None),
    };
    Some(ContextUsage {
        tokens,
        context_window,
        percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi::protocol::Conversation;

    fn conversation() -> Conversation {
        let mut conversation = Conversation::new("runtime".into(), "project".into());
        conversation.response(&json!({"success":true,"command":"get_state","data":{
            "sessionId":"session","model":{"provider":"local","id":"model"}
        }}));
        conversation
    }

    fn response(request: &Value) -> Value {
        json!({"id":request["id"],"type":"response","command":"get_session_stats","success":true,
            "data":{"tokens":{"total":999999},"contextUsage":{"tokens":12000,"contextWindow":200000,"percent":6}}})
    }

    #[test]
    fn reads_current_context_not_cumulative_tokens_and_preserves_unknown_after_compaction() {
        let conversation = conversation();
        let mut reader = ContextUsageReader::default();
        reader.invalidate();
        let request = reader.request(&conversation.snapshot).unwrap();
        let mut record = response(&request);
        let usage = reader
            .response(&record, &conversation.snapshot)
            .unwrap()
            .unwrap();
        assert_eq!(usage.tokens, Some(12000));
        assert_eq!(usage.percent, Some(6.0));
        reader.invalidate();
        let request = reader.request(&conversation.snapshot).unwrap();
        record["id"] = request["id"].clone();
        record["data"]["contextUsage"]["tokens"] = Value::Null;
        record["data"]["contextUsage"]["percent"] = Value::Null;
        let usage = reader
            .response(&record, &conversation.snapshot)
            .unwrap()
            .unwrap();
        assert_eq!(usage.context_window, 200000);
        assert_eq!(usage.tokens, None);
        assert_eq!(usage.percent, None);
        assert!(parse_usage(&json!({"contextWindow":0,"tokens":0,"percent":0})).is_none());
    }

    #[test]
    fn coalesces_changes_rejects_stale_replies_and_recovers_after_timeout() {
        let mut conversation = conversation();
        let mut reader = ContextUsageReader::default();
        reader.invalidate();
        let first = reader.request(&conversation.snapshot).unwrap();
        reader.invalidate();
        reader.invalidate();
        assert!(reader.request(&conversation.snapshot).is_none());
        assert!(
            reader
                .response(&response(&first), &conversation.snapshot)
                .is_none()
        );
        let fresh = reader.request(&conversation.snapshot).unwrap();
        conversation.snapshot.session_id = "other".into();
        assert!(
            reader
                .response(&response(&fresh), &conversation.snapshot)
                .is_none()
        );
        reader.invalidate();
        let old = reader.request(&conversation.snapshot).unwrap();
        reader.expire(Instant::now() + Duration::from_secs(6));
        assert!(
            reader
                .response(&response(&old), &conversation.snapshot)
                .is_none()
        );
        reader.invalidate();
        let next = reader.request(&conversation.snapshot).unwrap();
        assert!(
            reader
                .response(&response(&next), &conversation.snapshot)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn session_transition_waits_for_state_and_old_model_or_runtime_replies_are_ignored() {
        let mut conversation = conversation();
        let mut reader = ContextUsageReader::default();
        reader.begin_session();
        reader.resume(); // get_state during a transition must not publish to the old channel.
        assert!(reader.request(&conversation.snapshot).is_none());
        reader.end_session();
        let request = reader.request(&conversation.snapshot).unwrap();
        conversation.snapshot.model.as_mut().unwrap().id = "other".into();
        assert!(
            reader
                .response(&response(&request), &conversation.snapshot)
                .is_none()
        );
        reader.invalidate();
        let request = reader.request(&conversation.snapshot).unwrap();
        conversation.snapshot.instance_id = "reattached".into();
        assert!(
            reader
                .response(&response(&request), &conversation.snapshot)
                .is_none()
        );
        reader.invalidate();
        let request = reader.request(&conversation.snapshot).unwrap();
        let unavailable = json!({"id":request["id"],"success":false,"error":"unsupported"});
        assert!(
            reader
                .response(&unavailable, &conversation.snapshot)
                .unwrap()
                .is_none()
        );
    }
}
