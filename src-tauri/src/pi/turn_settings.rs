use super::types::{NextTurnSettings, RuntimeSnapshot};
use serde_json::{Value, json};
use std::path::Path;

pub(super) enum Action {
    Idle,
    Command(Value),
    Applied(Option<String>),
}

struct Application {
    revision: u64,
    selection: NextTurnSettings,
    step: u8,
    requested_thinking: Option<String>,
}

#[derive(Default)]
pub(super) struct TurnSettings {
    pub pending: Option<NextTurnSettings>,
    revision: u64,
    application: Option<Application>,
    failed: bool,
}

impl TurnSettings {
    pub fn update(
        &mut self,
        mut patch: NextTurnSettings,
        preferred: Option<String>,
        snapshot: &RuntimeSnapshot,
    ) -> Result<(), String> {
        if let Some(model) = &patch.model {
            patch.model = Some(
                snapshot
                    .models
                    .iter()
                    .find(|candidate| {
                        candidate.provider == model.provider && candidate.id == model.id
                    })
                    .cloned()
                    .ok_or("所选模型不可用，请刷新模型列表。")?,
            );
        }
        for level in [patch.thinking_level.as_deref(), preferred.as_deref()]
            .into_iter()
            .flatten()
        {
            if !["default", "off", "low", "medium", "high", "xhigh", "max"].contains(&level) {
                return Err("无效的思考强度。".into());
            }
        }
        let pending = self.pending.get_or_insert_with(NextTurnSettings::default);
        if patch.model.is_some() {
            pending.model = patch.model;
            if pending.thinking_level.is_none() && patch.thinking_level.is_none() {
                pending.thinking_level = Some(preferred.unwrap_or_else(|| "default".into()));
            }
        }
        if patch.thinking_level.is_some() {
            pending.thinking_level = patch.thinking_level;
        }
        if patch.permission_mode.is_some() {
            pending.permission_mode = patch.permission_mode;
        }
        self.revision += 1;
        self.failed = false;
        Ok(())
    }

    pub fn applying(&self) -> bool {
        self.application.is_some()
    }
    pub fn blocked(&self) -> bool {
        self.pending.is_some() || self.application.is_some()
    }

    pub fn fail(&mut self) {
        self.application = None;
        self.failed = true;
    }

    pub fn advance(
        &mut self,
        snapshot: &RuntimeSnapshot,
        source: &Path,
        token: &str,
    ) -> Result<Action, String> {
        if self.failed {
            return Ok(Action::Idle);
        }
        if self.application.is_none() {
            let Some(selection) = self.pending.clone() else {
                return Ok(Action::Idle);
            };
            self.application = Some(Application {
                revision: self.revision,
                selection,
                step: 0,
                requested_thinking: None,
            });
        }
        let active = self.application.as_mut().unwrap();
        loop {
            let step = active.step;
            active.step += 1;
            match step {
                0 => {
                    if let Some(model) = &active.selection.model {
                        if !snapshot.model.as_ref().is_some_and(|current| {
                            current.provider == model.provider && current.id == model.id
                        }) {
                            return Ok(Action::Command(
                                json!({"type":"set_model", "provider":model.provider, "modelId":model.id}),
                            ));
                        }
                    }
                }
                1 if active.selection.model.is_some() => {
                    return Ok(Action::Command(json!({"type":"get_state"})));
                }
                2 if active.selection.model.is_some() => {
                    return Ok(Action::Command(
                        json!({"type":"get_available_thinking_levels"}),
                    ));
                }
                3 => {
                    if let Some(mode) = active.selection.permission_mode {
                        if snapshot.permission_mode != mode {
                            return Ok(Action::Command(
                                json!({"type":"prompt", "message":format!("/hearth-permission {token} {}", mode.as_str())}),
                            ));
                        }
                    }
                }
                4 if active.selection.permission_mode.is_some() => {
                    return Ok(Action::Command(json!({"type":"get_entries"})));
                }
                5 if active.selection.permission_mode.is_some() => {
                    return Ok(Action::Command(json!({"type":"get_state"})));
                }
                6 => {
                    if let Some(requested) = &active.selection.thinking_level {
                        let requested = if requested == "default"
                            || !snapshot.available_thinking_levels.contains(requested)
                        {
                            "default"
                        } else {
                            requested.as_str()
                        };
                        active.requested_thinking = Some(requested.into());
                        let level = if requested == "default" {
                            let model = snapshot.model.as_ref().ok_or("请先选择模型。")?;
                            super::config::default_thinking_level(
                                source,
                                &model.provider,
                                &model.id,
                            )?
                        } else {
                            requested.into()
                        };
                        if snapshot.thinking_level != level {
                            return Ok(Action::Command(
                                json!({"type":"set_thinking_level", "level":level}),
                            ));
                        }
                    }
                }
                7 if active.selection.thinking_level.is_some() => {
                    return Ok(Action::Command(json!({"type":"get_state"})));
                }
                8 => {
                    if active
                        .selection
                        .permission_mode
                        .is_some_and(|mode| mode != snapshot.permission_mode)
                    {
                        return Err("会话权限未能保存，待发送消息已保留。".into());
                    }
                    if let Some(model) = &active.selection.model {
                        if !snapshot.model.as_ref().is_some_and(|current| {
                            current.provider == model.provider && current.id == model.id
                        }) {
                            return Err("模型未能切换，待发送消息已保留。".into());
                        }
                    }
                    let requested = active.requested_thinking.clone();
                    if active.revision == self.revision {
                        self.pending = None;
                    }
                    self.application = None;
                    return Ok(Action::Applied(requested));
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi::{protocol::Conversation, types::PermissionMode};

    #[test]
    fn newer_choices_are_applied_before_a_pending_transition_can_release_the_queue() {
        let mut snapshot = Conversation::new("test".into(), "project".into()).snapshot;
        let mut settings = TurnSettings::default();
        settings
            .update(
                NextTurnSettings {
                    permission_mode: Some(PermissionMode::Auto),
                    ..Default::default()
                },
                None,
                &snapshot,
            )
            .unwrap();
        let source = Path::new("unused");
        assert!(matches!(
            settings.advance(&snapshot, source, "token").unwrap(),
            Action::Command(_)
        ));
        settings
            .update(
                NextTurnSettings {
                    permission_mode: Some(PermissionMode::Full),
                    ..Default::default()
                },
                None,
                &snapshot,
            )
            .unwrap();
        snapshot.permission_mode = PermissionMode::Auto;
        loop {
            if matches!(
                settings.advance(&snapshot, source, "token").unwrap(),
                Action::Applied(_)
            ) {
                break;
            }
        }
        assert!(settings.blocked());
        let Action::Command(command) = settings.advance(&snapshot, source, "token").unwrap() else {
            panic!("latest choice must run next");
        };
        assert!(command["message"].as_str().unwrap().ends_with("full"));
        snapshot.permission_mode = PermissionMode::Full;
        loop {
            if matches!(
                settings.advance(&snapshot, source, "token").unwrap(),
                Action::Applied(_)
            ) {
                break;
            }
        }
        assert!(!settings.blocked());
    }

    #[test]
    fn failed_settings_keep_the_queue_blocked_until_an_explicit_new_choice() {
        let snapshot = Conversation::new("test".into(), "project".into()).snapshot;
        let mut settings = TurnSettings::default();
        let choice = NextTurnSettings {
            permission_mode: Some(PermissionMode::Full),
            ..Default::default()
        };
        settings.update(choice.clone(), None, &snapshot).unwrap();
        settings.fail();
        assert!(settings.blocked());
        assert!(matches!(
            settings
                .advance(&snapshot, Path::new("unused"), "token")
                .unwrap(),
            Action::Idle
        ));
        settings.update(choice, None, &snapshot).unwrap();
        assert!(matches!(
            settings
                .advance(&snapshot, Path::new("unused"), "token")
                .unwrap(),
            Action::Command(_)
        ));
    }
}
