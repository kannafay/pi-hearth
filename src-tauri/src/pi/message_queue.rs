use super::types::QueuedMessage;
use serde_json::Value;
use std::collections::VecDeque;

pub(super) struct QueuedPrompt {
    pub run_id: String,
    pub body: Value,
    bytes: usize,
}

#[derive(Default)]
pub(super) struct MessageQueue {
    prompts: VecDeque<QueuedPrompt>,
    bytes: usize,
}

impl MessageQueue {
    pub fn is_empty(&self) -> bool {
        self.prompts.is_empty()
    }

    pub fn push(&mut self, run_id: String, body: Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(&body)
            .map_err(|_| "消息无法加入队列。")?
            .len();
        if self.prompts.len() >= 32 || self.bytes + bytes > 64 * 1024 * 1024 {
            return Err("待发送消息过多，请等待队列中的消息处理后再发送。".into());
        }
        if self.prompts.iter().any(|prompt| prompt.run_id == run_id) {
            return Err("这条消息已在队列中。".into());
        }
        self.bytes += bytes;
        self.prompts.push_back(QueuedPrompt {
            run_id,
            body,
            bytes,
        });
        Ok(())
    }

    pub fn pop(&mut self) -> Option<QueuedPrompt> {
        let prompt = self.prompts.pop_front()?;
        self.bytes -= prompt.bytes;
        Some(prompt)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let index = self
            .prompts
            .iter()
            .position(|prompt| prompt.run_id == id)
            .ok_or("消息已开始处理或已被取消。")?;
        self.bytes -= self.prompts.remove(index).unwrap().bytes;
        Ok(())
    }

    pub fn clear(&mut self) {
        self.prompts.clear();
        self.bytes = 0;
    }

    pub fn messages(&self) -> Vec<QueuedMessage> {
        self.prompts
            .iter()
            .map(|prompt| QueuedMessage {
                id: prompt.run_id.clone(),
                text: prompt.body["__hearthMessage"]
                    .as_str()
                    .or_else(|| prompt.body["message"].as_str())
                    .unwrap_or_default()
                    .into(),
                attachments: serde_json::from_value(prompt.body["__hearthAttachments"].clone())
                    .unwrap_or_default(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bounds_and_cancellation_preserve_the_order_of_accepted_messages() {
        let mut queue = MessageQueue::default();
        for index in 0..32 {
            queue
                .push(
                    index.to_string(),
                    json!({"message":format!("message {index}")}),
                )
                .unwrap();
        }
        assert!(
            queue
                .push("overflow".into(), json!({"message":"keep the draft"}))
                .is_err()
        );
        assert!(
            queue
                .push("1".into(), json!({"message":"duplicate"}))
                .is_err()
        );
        queue.remove("1").unwrap();
        queue
            .push("last".into(), json!({"message":"last"}))
            .unwrap();
        assert_eq!(queue.pop().unwrap().run_id, "0");
        assert_eq!(queue.pop().unwrap().run_id, "2");
        assert_eq!(queue.messages().last().unwrap().id, "last");
        queue.clear();
        assert!(queue.is_empty());
        queue.push("new".into(), json!({"message":"new"})).unwrap();
        assert_eq!(queue.pop().unwrap().run_id, "new");
    }
}
