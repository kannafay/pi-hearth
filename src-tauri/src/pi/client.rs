use super::{
    config::{local_agent_directory, prepare_config, redact},
    process_tree::ProcessTree,
    protocol::{Conversation, JsonLines},
    tool_output::{ToolOutput, mask, result_text},
    types::*,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, mpsc, oneshot},
    time::{Instant, timeout},
};
use uuid::Uuid;

type Reply = oneshot::Sender<Result<Value, String>>;

enum Control {
    Restore {
        messages: Vec<Value>,
        reply: oneshot::Sender<Result<RuntimeSnapshot, String>>,
    },
    Request {
        body: Value,
        run_id: Option<String>,
        reply: Reply,
    },
    Subscribe {
        channel: Channel<PiEvent>,
        reply: oneshot::Sender<RuntimeSnapshot>,
    },
    Snapshot {
        reply: oneshot::Sender<RuntimeSnapshot>,
    },
    Decide {
        approval_id: String,
        allow: bool,
        reply: Reply,
    },
    Output {
        tool_id: String,
        section: String,
        offset: u32,
        reply: oneshot::Sender<Result<ToolLogPage, String>>,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

pub struct PiClient {
    pub instance_id: String,
    pub project_path: String,
    commands: mpsc::Sender<Control>,
}

#[derive(Clone)]
pub struct OpenOptions {
    pub session_directory: PathBuf,
    pub session_file: Option<String>,
    pub history: Vec<Value>,
}

struct Pending {
    reply: Reply,
    prompt_run: Option<String>,
    deadline: Instant,
}

struct Approval {
    call_id: String,
    run_id: String,
    deadline: Instant,
}

impl PiClient {
    pub async fn spawn(
        project_path: String,
        data_dir: &Path,
        channel: Channel<PiEvent>,
        options: Option<&OpenOptions>,
    ) -> Result<Arc<Self>, String> {
        let cli = pi_cli_path()?;
        let instance_id = Uuid::new_v4().to_string();
        let output = ToolOutput::new(&data_dir.join("tool-output").join(&instance_id)).await?;
        let guard = data_dir.join("runtime/tool-guard.mjs");
        std::fs::create_dir_all(guard.parent().unwrap())
            .map_err(|_| "无法创建工具审批模块目录。")?;
        std::fs::write(&guard, include_str!("../../../runtime/tool-guard.mjs"))
            .map_err(|_| "无法安装工具审批模块。")?;
        let agent_dir = data_dir.join("pi");
        let config = prepare_config(&local_agent_directory()?, &agent_dir)?;
        let source_agent_dir = local_agent_directory()?;
        let global_instructions = ["AGENTS.md", "CLAUDE.md"]
            .iter()
            .map(|name| source_agent_dir.join(name))
            .find(|path| path.is_file());
        let global_instructions = match global_instructions {
            Some(path) => std::fs::read_to_string(path).map_err(|_| "无法读取 Pi 全局指令。")?,
            None => String::new(),
        };
        std::fs::write(agent_dir.join("AGENTS.md"), global_instructions)
            .map_err(|_| "无法准备 Pi 全局指令。")?;
        let sessions = options
            .map(|options| options.session_directory.clone())
            .unwrap_or_else(|| data_dir.join("sessions"));
        std::fs::create_dir_all(&sessions).map_err(|_| "无法创建 Pi 会话目录。")?;
        let mut command = Command::new("node");
        command
            .arg(cli)
            .args([
                "--mode",
                "rpc",
                "--tools",
                if cfg!(windows) {
                    "read,write,edit,powershell"
                } else {
                    "read,write,edit,bash"
                },
                "--no-extensions",
                "--no-mcp",
                "--no-skills",
                "--no-prompt-templates",
                "--no-themes",
                "--no-approve",
                "--offline",
            ])
            .arg("--extension")
            .arg(&guard)
            .arg("--session-dir")
            .arg(sessions)
            .env("PI_CODING_AGENT_DIR", &agent_dir)
            .env("PI_TELEMETRY", "0")
            .envs(config.environment)
            .current_dir(&project_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(file) = options.and_then(|options| options.session_file.as_ref()) {
            command.arg("--session").arg(file);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|_| "无法启动 Pi：请确认 Node.js 22.19 或以上版本已加入 PATH。")?;
        let tree = match ProcessTree::attach(child.id().ok_or("Pi 进程未启动。")?) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };
        let mut stdin = child.stdin.take();
        let mut stdout = child.stdout.take().ok_or("无法读取 Pi 标准输出。")?;
        let mut stderr = child.stderr.take().ok_or("无法读取 Pi 诊断输出。")?;
        let (sender, mut receiver) = mpsc::channel::<Control>(32);
        let client = Arc::new(Self {
            instance_id: instance_id.clone(),
            project_path: project_path.clone(),
            commands: sender,
        });
        tauri::async_runtime::spawn(async move {
            let _tree = tree;
            let mut conversation = Conversation::new(instance_id, project_path);
            let mut channel = channel;
            let mut pending = HashMap::<String, Pending>::new();
            let mut approvals = HashMap::<String, Approval>::new();
            let mut decoder = JsonLines::default();
            let mut output_buffer = [0u8; 16384];
            let mut error_buffer = [0u8; 4096];
            let mut diagnostic_tail = Vec::<u8>::new();
            let mut stdout_open = true;
            let mut stderr_open = true;
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            let mut shutdown_reply = None;
            let mut exit_error = None;
            'runtime: loop {
                tokio::select! {
                    status = child.wait() => {
                        let summary = match status { Ok(status) => format!("Pi 进程已退出（{status}），请重新连接。"), Err(_) => "无法读取 Pi 进程状态，请重新连接。".into() };
                        let diagnostic = redact(String::from_utf8_lossy(&diagnostic_tail).trim().into(), &config.secrets);
                        exit_error = Some(if diagnostic.is_empty() { summary } else { format!("{summary}\n{diagnostic}") });
                        break;
                    }
                    control = receiver.recv() => {
                        match control {
                            Some(Control::Restore { messages, reply }) => {
                                if conversation.snapshot.active_run_id.is_some() { let _ = reply.send(Err("请先停止任务再恢复历史。".into())); continue; }
                                let mut result = Ok(());
                                for mut message in messages {
                                    mask_json(&mut message, &config.secrets);
                                    let records = conversation.restore_message(&message);
                                    for record in records {
                                        if let Err(error) = persist_tool(&output, &conversation, &record).await { result = Err(error); break; }
                                    }
                                    if result.is_err() { break; }
                                }
                                conversation.end_restore();
                                let _ = reply.send(result.map(|_| conversation.snapshot.clone()));
                            }
                            Some(Control::Request { mut body, run_id, reply }) => {
                                if matches!(body["type"].as_str(), Some("set_model" | "set_thinking_level")) && conversation.snapshot.active_run_id.is_some() {
                                    let _ = reply.send(Err("请先等待回复结束再修改模型设置。".into())); continue;
                                }
                                if let Some(run) = &run_id {
                                    let display = body.as_object_mut().and_then(|body| body.remove("__hearthMessage")).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_else(|| body["message"].as_str().unwrap_or_default().into());
                                    let attachments = body.as_object_mut().and_then(|body| body.remove("__hearthAttachments")).and_then(|value| serde_json::from_value(value).ok());
                                    match conversation.begin_with_attachments(run.clone(), display, attachments) {
                                        Ok(events) => emit(&channel, events),
                                        Err(error) => { let _ = reply.send(Err(error)); continue; }
                                    }
                                }
                                if body["type"] == "abort" || body["type"] == "clear_queue" {
                                    conversation.mark_cancelling();
                                    if deny_approvals(&mut approvals, &mut stdin, &mut conversation, &channel).await.is_err() {
                                        let _ = reply.send(Err("无法取消工具确认，连接已关闭。".into()));
                                        exit_error = Some("Pi 输入管道已中断，请重新连接。".into()); break;
                                    }
                                }
                                let id = Uuid::new_v4().to_string(); body["id"] = id.clone().into();
                                let mut bytes = serde_json::to_vec(&body).unwrap(); bytes.push(b'\n');
                                let written = match stdin.as_mut() {
                                    Some(input) => timeout(Duration::from_secs(5), input.write_all(&bytes)).await.is_ok_and(|result| result.is_ok()),
                                    None => false,
                                };
                                if !written {
                                    let _ = reply.send(Err("无法向 Pi 发送命令，连接已关闭。".into()));
                                    exit_error = Some("Pi 输入管道已中断，请重新连接。".into()); break;
                                }
                                let deadline = if body["type"] == "abort" || body["type"] == "clear_queue" { 5 } else { 20 };
                                pending.insert(id, Pending { reply, prompt_run: run_id, deadline: Instant::now() + Duration::from_secs(deadline) });
                            }
                            Some(Control::Subscribe { channel: next, reply }) => { channel = next; let _ = reply.send(conversation.snapshot.clone()); }
                            Some(Control::Snapshot { reply }) => { let _ = reply.send(conversation.snapshot.clone()); }
                            Some(Control::Decide { approval_id, allow, reply }) => {
                                let Some(approval) = approvals.remove(&approval_id) else {
                                    let _ = reply.send(Err("工具确认已过期或已经处理。".into())); continue;
                                };
                                let valid = approval.deadline > Instant::now() && Some(&approval.run_id) == conversation.snapshot.active_run_id.as_ref() && !conversation.is_cancelling();
                                let accepted = valid && allow;
                                let written = write_wire(&mut stdin, &json!({"type":"extension_ui_response","id":approval_id,"confirmed":accepted})).await;
                                emit(&channel, conversation.approval_decided(&approval.call_id, accepted));
                                if !written {
                                    let _ = reply.send(Err("无法发送工具确认，连接已关闭。".into()));
                                    exit_error = Some("Pi 输入管道已中断，请重新连接。".into()); break;
                                }
                                let _ = reply.send(if valid { Ok(Value::Null) } else { Err("工具确认已过期或任务已停止。".into()) });
                            }
                            Some(Control::Output { tool_id, section, offset, reply }) => {
                                let result = if conversation.snapshot.tools.iter().any(|tool| tool.id == tool_id) {
                                    output.page(&tool_id, &section, offset).await
                                } else { Err("工具记录不存在。".into()) };
                                let _ = reply.send(result);
                            }
                            Some(Control::Shutdown { reply }) => { shutdown_reply = Some(reply); break; }
                            None => break,
                        }
                    }
                    result = stdout.read(&mut output_buffer), if stdout_open => {
                        match result {
                            Ok(0) => stdout_open = false,
                            Ok(length) => {
                                let records = match decoder.push(&output_buffer[..length]) {
                                    Ok(records) => records,
                                    Err(error) => { exit_error = Some(error); break; }
                                };
                                for mut record in records {
                                    // Provider errors may echo request headers. Redact before adaptation,
                                    // and never forward raw model objects or stderr to the webview.
                                    if let Some(error) = record.get_mut("error").filter(|value| value.is_string()) {
                                        *error = redact(error.as_str().unwrap().into(), &config.secrets).into();
                                    }
                                    if let Some(error) = record.pointer_mut("/message/errorMessage").filter(|value| value.is_string()) {
                                        *error = redact(error.as_str().unwrap().into(), &config.secrets).into();
                                    }
                                    if record["type"] == "response" {
                                        conversation.response(&record);
                                        if let Some(request) = record["id"].as_str().and_then(|id| pending.remove(id)) {
                                            let result: Result<Value, String> = if record["success"] == true { Ok(record["data"].clone()) } else { Err(record["error"].as_str().unwrap_or("Pi 拒绝了命令。").into()) };
                                            if request.prompt_run.as_ref() == conversation.snapshot.active_run_id.as_ref() && request.prompt_run.is_some() {
                                                match &result {
                                                    Err(error) => emit(&channel, conversation.finish("failed", Some(error.clone()))),
                                                    Ok(data) if data["disposition"] == "handled" => emit(&channel, conversation.finish("complete", None)),
                                                    _ => {}
                                                }
                                            }
                                            let _ = request.reply.send(result);
                                        }
                                    } else if record["type"] == "extension_ui_request" {
                                        if let Some((id, mut approval_record)) = approval_record(&record) {
                                            mask_json(&mut approval_record, &config.secrets);
                                            if conversation.snapshot.active_run_id.is_none() || conversation.is_cancelling() {
                                                if !write_wire(&mut stdin, &json!({"type":"extension_ui_response","id":id,"confirmed":false})).await {
                                                    exit_error = Some("无法拒绝已停止任务的工具确认。".into()); break 'runtime;
                                                }
                                                continue;
                                            }
                                            let call_id = approval_record["toolCallId"].as_str().unwrap().to_owned();
                                            let events = conversation.record(&approval_record);
                                            if persist_tool(&output, &conversation, &approval_record).await.is_err() {
                                                exit_error = Some("无法保存工具参数，执行已中止。".into()); break 'runtime;
                                            }
                                            approvals.insert(id.clone(), Approval { call_id: call_id.clone(), run_id: conversation.snapshot.active_run_id.clone().unwrap(), deadline: Instant::now() + Duration::from_secs(120) });
                                            let delivered = events.into_iter().all(|event| channel.send(event).is_ok());
                                            if !delivered {
                                                approvals.remove(&id);
                                                if !write_wire(&mut stdin, &json!({"type":"extension_ui_response","id":id,"confirmed":false})).await {
                                                    exit_error = Some("工具确认通道已中断。".into()); break 'runtime;
                                                }
                                                emit(&channel, conversation.approval_decided(&call_id, false));
                                            }
                                        } else if record["id"].is_string() && matches!(record["method"].as_str(), Some("confirm" | "select" | "input" | "editor"))
                                            && !write_wire(&mut stdin, &json!({"type":"extension_ui_response","id":record["id"],"cancelled":true})).await {
                                            exit_error = Some("无法关闭未支持的工具确认。".into()); break 'runtime;
                                        }
                                    } else {
                                        if record["type"].as_str().is_some_and(|kind| kind.starts_with("tool_execution_")) { mask_json(&mut record, &config.secrets); }
                                        let events = conversation.record(&record);
                                        if persist_tool(&output, &conversation, &record).await.is_err() {
                                            exit_error = Some("无法保存工具输出，执行已中止。".into()); break 'runtime;
                                        }
                                        emit(&channel, events);
                                        if record["type"] == "tool_execution_end" {
                                            approvals.retain(|_, approval| record["toolCallId"] != approval.call_id);
                                        }
                                        if record["type"] == "agent_settled" {
                                            approvals.clear();
                                        }
                                    }
                                }
                            }
                            Err(_) => { exit_error = Some("Pi 输出管道已中断，请重新连接。".into()); break; }
                        }
                    }
                    result = stderr.read(&mut error_buffer), if stderr_open => {
                        // Keep a bounded diagnostic tail; redact before reporting it.
                        match result {
                            Ok(length) if length > 0 => {
                                diagnostic_tail.extend_from_slice(&error_buffer[..length]);
                                if diagnostic_tail.len() > 8192 { diagnostic_tail.drain(..diagnostic_tail.len()-8192); }
                            }
                            _ => stderr_open = false,
                        }
                    }
                    _ = tick.tick() => {
                        let expired: Vec<_> = approvals.iter().filter(|(_, approval)| approval.deadline <= Instant::now()).map(|(id, _)| id.clone()).collect();
                        for id in expired {
                            let approval = approvals.remove(&id).unwrap();
                            if !write_wire(&mut stdin, &json!({"type":"extension_ui_response","id":id,"confirmed":false})).await {
                                exit_error = Some("工具确认超时，连接已关闭。".into()); break 'runtime;
                            }
                            emit(&channel, conversation.approval_decided(&approval.call_id, false));
                        }
                        if pending.values().any(|request| request.deadline <= Instant::now()) {
                            exit_error = Some("Pi 命令响应超时，连接已关闭，请重新连接。".into()); break;
                        }
                    }
                }
            }
            conversation.mark_cancelling();
            let _ = deny_approvals(&mut approvals, &mut stdin, &mut conversation, &channel).await;
            for (_, request) in pending {
                let _ = request.reply.send(Err(exit_error
                    .clone()
                    .unwrap_or_else(|| "Pi 连接已关闭。".into())));
            }
            emit(
                &channel,
                conversation.finish(
                    if shutdown_reply.is_some() {
                        "cancelled"
                    } else {
                        "failed"
                    },
                    exit_error.clone(),
                ),
            );
            drop(stdin.take());
            // Closing stdin requests Pi's normal shutdown. A stalled runtime is reaped;
            // dropping the job/process group also removes only our managed descendants.
            if timeout(Duration::from_secs(3), child.wait()).await.is_err() {
                let _ = child.kill().await;
            }
            let event = conversation.event(EventData::Disconnected { error: exit_error });
            let _ = channel.send(event);
            drop(_tree);
            if let Some(reply) = shutdown_reply {
                let _ = reply.send(());
            }
        });
        Ok(client)
    }

    pub async fn request(&self, body: Value, run_id: Option<String>) -> Result<Value, String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Request {
                body,
                run_id,
                reply,
            })
            .await
            .map_err(|_| "Pi 连接已关闭，请重新连接。")?;
        timeout(Duration::from_secs(25), receive)
            .await
            .map_err(|_| "Pi 命令响应超时。")?
            .map_err(|_| "Pi 连接已关闭。")?
    }

    pub async fn restore(&self, messages: Vec<Value>) -> Result<RuntimeSnapshot, String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Restore { messages, reply })
            .await
            .map_err(|_| "Pi 连接已关闭。")?;
        timeout(Duration::from_secs(30), receive)
            .await
            .map_err(|_| "恢复历史超时。")?
            .map_err(|_| "Pi 连接已关闭。")?
    }

    pub async fn decide(&self, approval_id: String, allow: bool) -> Result<(), String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Decide {
                approval_id,
                allow,
                reply,
            })
            .await
            .map_err(|_| "Pi 连接已关闭。")?;
        timeout(Duration::from_secs(7), receive)
            .await
            .map_err(|_| "工具确认响应超时。")?
            .map_err(|_| "Pi 连接已关闭。")??;
        Ok(())
    }

    pub async fn tool_output(
        &self,
        tool_id: String,
        section: String,
        offset: u32,
    ) -> Result<ToolLogPage, String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Output {
                tool_id,
                section,
                offset,
                reply,
            })
            .await
            .map_err(|_| "Pi 连接已关闭。")?;
        timeout(Duration::from_secs(7), receive)
            .await
            .map_err(|_| "加载工具输出超时。")?
            .map_err(|_| "Pi 连接已关闭。")?
    }

    pub async fn subscribe(&self, channel: Channel<PiEvent>) -> Result<RuntimeSnapshot, String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Subscribe { channel, reply })
            .await
            .map_err(|_| "Pi 连接已关闭，请重新连接。")?;
        timeout(Duration::from_secs(5), receive)
            .await
            .map_err(|_| "读取 Pi 状态超时。")?
            .map_err(|_| "Pi 连接已关闭。".into())
    }

    pub async fn shutdown(&self) {
        let (reply, receive) = oneshot::channel();
        if self
            .commands
            .send(Control::Shutdown { reply })
            .await
            .is_ok()
        {
            let _ = timeout(Duration::from_secs(5), receive).await;
        }
    }

    pub async fn snapshot(&self) -> Result<RuntimeSnapshot, String> {
        let (reply, receive) = oneshot::channel();
        self.commands
            .send(Control::Snapshot { reply })
            .await
            .map_err(|_| "Pi 连接已关闭。")?;
        timeout(Duration::from_secs(5), receive)
            .await
            .map_err(|_| "读取 Pi 状态超时。")?
            .map_err(|_| "Pi 连接已关闭。".into())
    }
}

async fn write_wire(stdin: &mut Option<tokio::process::ChildStdin>, value: &Value) -> bool {
    let mut bytes = serde_json::to_vec(value).unwrap();
    bytes.push(b'\n');
    match stdin.as_mut() {
        Some(input) => timeout(Duration::from_secs(5), input.write_all(&bytes))
            .await
            .is_ok_and(|result| result.is_ok()),
        None => false,
    }
}

async fn deny_approvals(
    approvals: &mut HashMap<String, Approval>,
    stdin: &mut Option<tokio::process::ChildStdin>,
    conversation: &mut Conversation,
    channel: &Channel<PiEvent>,
) -> Result<(), ()> {
    for (id, approval) in approvals.drain() {
        if !write_wire(
            stdin,
            &json!({"type":"extension_ui_response","id":id,"confirmed":false}),
        )
        .await
        {
            return Err(());
        }
        emit(
            channel,
            conversation.approval_decided(&approval.call_id, false),
        );
    }
    Ok(())
}

fn approval_record(record: &Value) -> Option<(String, Value)> {
    if record["method"] != "confirm" {
        return None;
    }
    let payload: Value = serde_json::from_str(record["message"].as_str()?).ok()?;
    if payload["kind"] != "pi-hearth-tool-approval-v1"
        || !payload["args"].is_object()
        || payload["toolCallId"].as_str()?.is_empty()
        || !matches!(
            payload["toolName"].as_str()?,
            "read" | "write" | "edit" | "bash" | "powershell"
        )
    {
        return None;
    }
    let id = record["id"].as_str()?.to_owned();
    Some((
        id.clone(),
        json!({"type":"tool_approval","toolCallId":payload["toolCallId"],"toolName":payload["toolName"],"args":payload["args"],"approvalId":id}),
    ))
}

fn mask_json(value: &mut Value, secrets: &[String]) {
    match value {
        Value::String(text) => *text = mask(text, secrets),
        Value::Array(items) => {
            for item in items {
                mask_json(item, secrets);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                mask_json(item, secrets);
            }
        }
        _ => {}
    }
}

async fn persist_tool(
    output: &ToolOutput,
    conversation: &Conversation,
    record: &Value,
) -> Result<(), String> {
    let Some(index) = record["toolCallId"]
        .as_str()
        .and_then(|id| conversation.tool_index(id))
    else {
        return Ok(());
    };
    let id = &conversation.snapshot.tools[index].id;
    if let Some(args) = record.get("args").filter(|args| args.is_object()) {
        output
            .write(
                id,
                "arguments",
                &serde_json::to_string_pretty(args).unwrap(),
            )
            .await?;
    }
    if let Some(result) = record.get("partialResult").or(record.get("result")) {
        output.write(id, "output", &result_text(result)).await?;
    }
    Ok(())
}

fn emit(channel: &Channel<PiEvent>, events: Vec<PiEvent>) {
    for event in events {
        let _ = channel.send(event);
    }
}

fn pi_cli_path() -> Result<PathBuf, String> {
    // The development runtime is pinned in package.json. Release sidecars are a
    // separate packaging step; never silently run an arbitrary global Pi version.
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
    if !path.is_file() {
        return Err("缺少项目 Pi 运行时，请先运行 pnpm install。".into());
    }
    dunce::canonicalize(path).map_err(|_| "无法定位 Pi 运行时。".into())
}

#[derive(Default)]
pub struct PiManager {
    runtime: Mutex<Option<Arc<PiClient>>>,
    read_only: Mutex<Option<(RuntimeSnapshot, ToolOutput)>>,
}

impl PiManager {
    pub async fn connect(
        &self,
        project_path: String,
        data_dir: &Path,
        channel: Channel<PiEvent>,
    ) -> Result<RuntimeSnapshot, String> {
        self.connect_options(project_path, data_dir, channel, None)
            .await
    }

    pub async fn open(
        &self,
        project_path: String,
        data_dir: &Path,
        channel: Channel<PiEvent>,
        options: OpenOptions,
    ) -> Result<RuntimeSnapshot, String> {
        self.connect_options(project_path, data_dir, channel, Some(options))
            .await
    }

    async fn connect_options(
        &self,
        project_path: String,
        data_dir: &Path,
        channel: Channel<PiEvent>,
        options: Option<OpenOptions>,
    ) -> Result<RuntimeSnapshot, String> {
        let path = dunce::canonicalize(project_path).map_err(|_| "项目目录不存在或无法访问。")?;
        if !path.is_dir() {
            return Err("请选择有效的项目文件夹。".into());
        }
        let project_path = path.to_str().ok_or("项目路径不是有效 UTF-8。")?.to_owned();
        let mut runtime = self.runtime.lock().await;
        if let Some(current) = runtime.as_ref() {
            if current.project_path == project_path && options.is_none() {
                if let Ok(snapshot) = current.subscribe(channel.clone()).await {
                    return Ok(snapshot);
                }
            } else {
                let snapshot = current.snapshot().await;
                if snapshot.is_ok_and(|snapshot| snapshot.active_run_id.is_some()) {
                    return Err("请先停止当前回复再切换项目。".into());
                }
            }
            current.shutdown().await;
        }
        *runtime = None;
        *self.read_only.lock().await = None;
        let client =
            PiClient::spawn(project_path, data_dir, channel.clone(), options.as_ref()).await?;
        let initialize = async {
            let commands = client.request(json!({"type":"get_commands"}), None).await?;
            if !commands["commands"].as_array().is_some_and(|commands| {
                commands.iter().any(|command| {
                    command["name"] == "hearth-guard-ready" && command["source"] == "extension"
                })
            }) {
                return Err("工具审批模块未加载，已关闭 Pi 连接。请重新构建客户端。".into());
            }
            client.request(json!({"type":"get_state"}), None).await?;
            client
                .request(json!({"type":"get_available_models"}), None)
                .await?;
            let snapshot = client.subscribe(channel.clone()).await?;
            if snapshot.models.is_empty() {
                return Err(
                    "没有可用模型，请在 CC Switch 中配置 Pi 的提供商与 API Key，然后重新连接。"
                        .into(),
                );
            }
            if !snapshot.models.is_empty()
                && !snapshot.models.iter().any(|m| {
                    snapshot
                        .model
                        .as_ref()
                        .is_some_and(|model| model.provider == m.provider && model.id == m.id)
                })
            {
                let model = snapshot
                    .models
                    .iter()
                    .find(|m| m.provider.starts_with("cc-switch"))
                    .unwrap_or(&snapshot.models[0]);
                client
                    .request(
                        json!({"type":"set_model","provider":model.provider,"modelId":model.id}),
                        None,
                    )
                    .await?;
            }
            if let Some(options) = options {
                client.restore(options.history).await?;
            }
            client.request(json!({"type":"get_state"}), None).await?;
            client
                .request(json!({"type":"get_available_thinking_levels"}), None)
                .await?;
            client.subscribe(channel).await
        }
        .await;
        match initialize {
            Ok(snapshot) => {
                *runtime = Some(client);
                Ok(snapshot)
            }
            Err(error) => {
                client.shutdown().await;
                Err(error)
            }
        }
    }

    pub async fn client(&self, instance_id: &str) -> Result<Arc<PiClient>, String> {
        self.runtime
            .lock()
            .await
            .as_ref()
            .filter(|client| client.instance_id == instance_id)
            .cloned()
            .ok_or_else(|| "当前 Pi 连接已失效，请重新连接。".into())
    }

    pub async fn disconnect(&self) {
        if let Some(client) = self.runtime.lock().await.take() {
            client.shutdown().await;
        }
        *self.read_only.lock().await = None;
    }

    pub async fn open_read_only(
        &self,
        cwd: String,
        session_id: String,
        file: String,
        history: Vec<Value>,
        data: &Path,
    ) -> Result<RuntimeSnapshot, String> {
        let mut runtime = self.runtime.lock().await;
        if let Some(current) = runtime.as_ref() {
            if current
                .snapshot()
                .await
                .is_ok_and(|snapshot| snapshot.active_run_id.is_some())
            {
                return Err("请先停止当前任务再切换会话。".into());
            }
            current.shutdown().await;
        }
        *runtime = None;
        let instance = Uuid::new_v4().to_string();
        let output = ToolOutput::new(&data.join("tool-output").join(&instance)).await?;
        let config = prepare_config(&local_agent_directory()?, &data.join("pi"))?;
        let mut conversation = Conversation::new(instance, cwd);
        conversation.snapshot.session_id = session_id;
        conversation.snapshot.session_file = Some(file);
        conversation.snapshot.read_only = Some("原工作目录不存在，此会话仅可查看。".into());
        for mut message in history {
            mask_json(&mut message, &config.secrets);
            for record in conversation.restore_message(&message) {
                persist_tool(&output, &conversation, &record).await?;
            }
        }
        conversation.end_restore();
        let snapshot = conversation.snapshot;
        *self.read_only.lock().await = Some((snapshot.clone(), output));
        Ok(snapshot)
    }

    pub async fn tool_output(
        &self,
        instance_id: &str,
        tool_id: String,
        section: String,
        offset: u32,
    ) -> Result<ToolLogPage, String> {
        {
            let read_only = self.read_only.lock().await;
            if let Some((snapshot, output)) = read_only
                .as_ref()
                .filter(|(snapshot, _)| snapshot.instance_id == instance_id)
            {
                if !snapshot.tools.iter().any(|tool| tool.id == tool_id) {
                    return Err("工具记录不存在。".into());
                }
                return output.page(&tool_id, &section, offset).await;
            }
        }
        self.client(instance_id)
            .await?
            .tool_output(tool_id, section, offset)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_working_directory_history_is_read_only_with_tool_results() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/read-only-test")
            .join(Uuid::new_v4().to_string());
        let manager = PiManager::default();
        let snapshot = manager.open_read_only("missing-project".into(), "native-id".into(), "history.jsonl".into(), vec![
            json!({"role":"user","content":"read"}),
            json!({"role":"assistant","content":[{"type":"toolCall","id":"read-1","name":"read","arguments":{"path":"a"}}],"stopReason":"toolUse"}),
            json!({"role":"toolResult","toolCallId":"read-1","toolName":"read","content":[{"type":"text","text":"historical output"}],"isError":false}),
        ], &root).await.unwrap();
        assert!(snapshot.read_only.is_some());
        assert_eq!(snapshot.session_id, "native-id");
        assert!(manager.client(&snapshot.instance_id).await.is_err());
        let page = manager
            .tool_output(
                &snapshot.instance_id,
                snapshot.tools[0].id.clone(),
                "output".into(),
                0,
            )
            .await
            .unwrap();
        assert_eq!(page.content, "historical output");
        manager.disconnect().await;
        assert!(
            manager
                .tool_output(
                    &snapshot.instance_id,
                    snapshot.tools[0].id.clone(),
                    "output".into(),
                    0
                )
                .await
                .is_err()
        );
    }

    #[tokio::test]
    #[ignore = "uses configured model to verify shared native sessions, instructions and general chats"]
    async fn live_native_sessions_and_projects() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/native-session-live")
            .join(Uuid::new_v4().to_string());
        let project_a = root.join("项目一");
        let project_b = root.join("项目二");
        let general = root.join("general");
        for path in [&project_a, &project_b, &general] {
            std::fs::create_dir_all(path).unwrap();
        }
        let project_a = dunce::canonicalize(project_a).unwrap();
        let project_b = dunce::canonicalize(project_b).unwrap();
        let general = dunce::canonicalize(general).unwrap();
        std::fs::write(
            project_a.join("AGENTS.md"),
            "当用户询问项目暗号时，只回复 PROJECT-ALPHA-71。不要调用工具。",
        )
        .unwrap();
        std::fs::write(
            project_b.join("AGENTS.md"),
            "当用户询问项目暗号时，只回复 PROJECT-BETA-92。不要调用工具。",
        )
        .unwrap();
        let data = root.join("data");
        let manager = PiManager::default();
        let (sender, mut events) = mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            let _ = sender.send(body.deserialize::<Value>().unwrap());
            Ok(())
        });

        async fn ask(
            client: &PiClient,
            events: &mut mpsc::UnboundedReceiver<Value>,
            text: &str,
        ) -> String {
            let run = Uuid::new_v4().to_string();
            client
                .request(json!({"type":"prompt","message":text}), Some(run.clone()))
                .await
                .unwrap();
            let results = finished(events, &run).await;
            assert_eq!(results.last().unwrap()["data"]["status"], "complete");
            results
                .iter()
                .filter(|event| event["data"]["type"] == "message_completed")
                .filter_map(|event| event["data"]["message"]["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }
        async fn open(
            manager: &PiManager,
            cwd: &Path,
            data: &Path,
            channel: Channel<PiEvent>,
            session: Option<String>,
        ) -> (RuntimeSnapshot, Arc<PiClient>) {
            let history = if let Some(file) = &session {
                serde_json::from_value(
                    super::super::catalog::helper(data, json!({"action":"history","path":file}))
                        .await
                        .unwrap(),
                )
                .unwrap()
            } else {
                vec![]
            };
            let snapshot = manager
                .open(
                    cwd.to_string_lossy().into(),
                    data,
                    channel,
                    OpenOptions {
                        session_directory: cwd.join(".sessions"),
                        session_file: session,
                        history,
                    },
                )
                .await
                .unwrap();
            let client = manager.client(&snapshot.instance_id).await.unwrap();
            let model = snapshot
                .models
                .iter()
                .find(|model| model.provider.starts_with("cc-switch"))
                .unwrap();
            client
                .request(
                    json!({"type":"set_model","provider":model.provider,"modelId":model.id}),
                    None,
                )
                .await
                .unwrap();
            (snapshot, client)
        }

        let (first, client) = open(&manager, &project_a, &data, channel.clone(), None).await;
        let answer = ask(
            &client,
            &mut events,
            "请告诉我项目指令中指定的项目暗号。只输出暗号。",
        )
        .await;
        assert!(answer.contains("PROJECT-ALPHA-71"), "{answer}");
        let first_file = first.session_file.unwrap();
        assert!(Path::new(&first_file).is_file());
        let (second, client) = open(&manager, &project_a, &data, channel.clone(), None).await;
        assert_ne!(second.session_file.as_ref(), Some(&first_file));
        ask(
            &client,
            &mut events,
            "记住仅属于这份对话的暗号 SESSION-TWO-XYZ，只回复已记住。",
        )
        .await;
        let (restored, client) = open(
            &manager,
            &project_a,
            &data,
            channel.clone(),
            Some(first_file.clone()),
        )
        .await;
        assert_eq!(restored.messages.len(), 2);
        assert!(
            !restored
                .messages
                .iter()
                .any(|message| message.text.contains("SESSION-TWO-XYZ"))
        );
        let answer = ask(
            &client,
            &mut events,
            "请告诉我项目指令中指定的项目暗号。只输出暗号。",
        )
        .await;
        assert!(answer.contains("PROJECT-ALPHA-71"));
        println!("Native session restored: original history/context; second session isolated");

        let (_, client) = open(&manager, &project_b, &data, channel.clone(), None).await;
        let answer = ask(
            &client,
            &mut events,
            "请告诉我项目指令中指定的项目暗号。只输出暗号。",
        )
        .await;
        assert!(answer.contains("PROJECT-BETA-92"), "{answer}");
        println!("Project instructions: A and B isolated and read by real model");

        let (snapshot, client) = open(&manager, &general, &data, channel, None).await;
        assert!(snapshot.messages.is_empty());
        let answer = ask(
            &client,
            &mut events,
            "只回复 HEARTH-GENERAL-OK，不要调用工具。",
        )
        .await;
        assert!(answer.contains("HEARTH-GENERAL-OK"));
        println!("General chat: works without a user project");
        manager.disconnect().await;
        let restored =
            super::super::catalog::helper(&data, json!({"action":"history","path":first_file}))
                .await
                .unwrap();
        assert_eq!(restored.as_array().unwrap().len(), 4);
        println!("Desktop continuation persisted in native Pi JSONL history");
    }

    async fn tool_run(
        client: &PiClient,
        events: &mut mpsc::UnboundedReceiver<Value>,
        message: String,
        allowed: impl Fn(&Value) -> bool,
        cancel_on_output: bool,
    ) -> Vec<Value> {
        let run = Uuid::new_v4().to_string();
        client
            .request(
                json!({"type":"prompt","message":message}),
                Some(run.clone()),
            )
            .await
            .unwrap();
        timeout(Duration::from_secs(150), async {
            let mut received = vec![];
            let mut stopped = false;
            loop {
                let event = events.recv().await.unwrap();
                if event["runId"] != run {
                    continue;
                }
                if event["data"]["type"] == "tool_changed" {
                    let tool = &event["data"]["tool"];
                    if let Some(id) = tool["approvalId"].as_str() {
                        let args: Value =
                            serde_json::from_str(tool["arguments"].as_str().unwrap()).unwrap();
                        let allow = allowed(&args);
                        println!(
                            "Tool {}: {}",
                            tool["name"],
                            if allow { "allow" } else { "deny" }
                        );
                        client.decide(id.into(), allow).await.unwrap();
                    }
                    if cancel_on_output
                        && !stopped
                        && tool["status"] == "running"
                        && tool["output"]
                            .as_str()
                            .is_some_and(|text| text.contains("HEARTH-WAIT"))
                    {
                        stopped = true;
                        client
                            .request(json!({"type":"clear_queue"}), None)
                            .await
                            .unwrap();
                        client.request(json!({"type":"abort"}), None).await.unwrap();
                    }
                }
                let done = event["data"]["type"] == "run_finished";
                received.push(event);
                if done {
                    return received;
                }
            }
        })
        .await
        .expect("tool run timed out")
    }

    #[tokio::test]
    #[ignore = "executes isolated file and command tests with the configured Pi model"]
    async fn live_rpc_tools_and_approval() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/tool-smoke")
            .join(Uuid::new_v4().to_string());
        let project = root.join("中文 project");
        std::fs::create_dir_all(&project).unwrap();
        let project = dunce::canonicalize(project).unwrap();
        let (sender, mut events) = mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            let _ = sender.send(body.deserialize::<Value>().unwrap());
            Ok(())
        });
        let manager = PiManager::default();
        let snapshot = manager
            .connect(
                project.to_string_lossy().into(),
                &root.join("data"),
                channel,
            )
            .await
            .unwrap();
        let client = manager.client(&snapshot.instance_id).await.unwrap();
        let model = snapshot
            .models
            .iter()
            .find(|model| model.provider.starts_with("cc-switch"))
            .unwrap();
        client
            .request(
                json!({"type":"set_model","provider":model.provider,"modelId":model.id}),
                None,
            )
            .await
            .unwrap();
        println!(
            "Live tools: {}/{}; project {}",
            model.provider,
            model.id,
            project.display()
        );
        let file = project.join("工具测试.txt");
        let command = if cfg!(windows) {
            "Write-Output 'HEARTH-COMMAND-OK'"
        } else {
            "printf 'HEARTH-COMMAND-OK\\n'"
        };
        let shell = if cfg!(windows) { "powershell" } else { "bash" };
        let result = tool_run(&client, &mut events,
            format!("这是隔离目录内的客户端工具联调。请按顺序实际调用工具：1.用 write 创建 工具测试.txt，内容必须为 alpha；2.用 edit 将 alpha 替换为 beta；3.用 read 读取该文件；4.调用 {shell}，command 参数必须逐字为 {command}。不要使用其他路径或命令，不要用命令操作文件。每个工具只调用一次，完成后简短汇报。"),
            |args| args["path"].as_str().is_some_and(|path| Path::new(path) == file) || args["command"] == command, false).await;
        assert_eq!(result.last().unwrap()["data"]["status"], "complete");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "beta");
        let snapshot = client.snapshot().await.unwrap();
        for name in ["write", "edit", "read", shell] {
            assert!(
                snapshot
                    .tools
                    .iter()
                    .any(|tool| tool.name == name && tool.status == "complete"),
                "missing completed {name}"
            );
        }
        assert!(
            snapshot
                .tools
                .iter()
                .any(|tool| tool.output.contains("HEARTH-COMMAND-OK"))
        );
        let read = snapshot
            .tools
            .iter()
            .find(|tool| tool.name == "read")
            .unwrap();
        assert!(
            !result
                .iter()
                .any(|event| event["data"]["tool"]["id"] == read.id
                    && event["data"]["tool"]["status"] == "awaiting_approval")
        );
        let command_tool = snapshot
            .tools
            .iter()
            .find(|tool| tool.name == shell)
            .unwrap();
        assert!(
            client
                .tool_output(command_tool.id.clone(), "output".into(), 0)
                .await
                .unwrap()
                .content
                .contains("HEARTH-COMMAND-OK")
        );
        println!(
            "Write/edit/read/command: actual file beta; live output and saved result verified"
        );

        let denied = tool_run(&client, &mut events, "仅调用一次 write 创建 forbidden.txt，内容 forbidden；如果被拒绝，立即结束，不要尝试其他工具或路径。".into(), |_| false, false).await;
        assert!(!project.join("forbidden.txt").exists());
        assert!(
            denied
                .iter()
                .any(|event| event["data"]["tool"]["status"] == "denied")
        );
        println!("Rejected write: no file created");

        let command = if cfg!(windows) {
            "Write-Output 'HEARTH-FAIL'; exit 7"
        } else {
            "printf 'HEARTH-FAIL\\n'; exit 7"
        };
        let failed = tool_run(&client, &mut events, format!("现在只调用一次 {shell} 做预期失败测试。command 参数必须逐字为 {command}。不要修复或重试，结束后汇报失败。"), |args| args["command"] == command, false).await;
        assert!(failed.iter().any(|event| {
            event["data"]["tool"]["status"] == "failed"
                && event["data"]["tool"]["output"]
                    .as_str()
                    .is_some_and(|text| text.contains("HEARTH-FAIL"))
        }));
        println!("Command failure: nonzero exit displayed");

        let command = if cfg!(windows) {
            "Write-Output 'HEARTH-WAIT'; Start-Sleep -Seconds 30; Set-Content -LiteralPath 'should-not-exist.txt' -Value 'late'"
        } else {
            "printf 'HEARTH-WAIT\\n'; sleep 30; printf late > should-not-exist.txt"
        };
        let cancelled = tool_run(&client, &mut events, format!("只调用一次 {shell}，command 参数必须逐字为 {command}。这是命令中止测试，不要使用其他命令。"), |args| args["command"] == command, true).await;
        assert_eq!(cancelled.last().unwrap()["data"]["status"], "cancelled");
        assert!(
            cancelled
                .iter()
                .any(|event| event["data"]["tool"]["status"] == "cancelled")
        );
        assert!(!project.join("should-not-exist.txt").exists());
        assert!(client.snapshot().await.unwrap().active_run_id.is_none());
        println!("Running command aborted: no delayed file; runtime idle");
        manager.disconnect().await;
        assert!(client.snapshot().await.is_err());
    }

    async fn finished(events: &mut mpsc::UnboundedReceiver<Value>, run_id: &str) -> Vec<Value> {
        timeout(Duration::from_secs(90), async {
            let mut received = Vec::new();
            loop {
                let event = events.recv().await.expect("event channel closed");
                if event["runId"] != run_id {
                    continue;
                }
                let done = event["data"]["type"] == "run_finished";
                received.push(event);
                if done {
                    return received;
                }
            }
        })
        .await
        .expect("live model response timed out")
    }

    // Explicit opt-in: uses the developer's existing CC Switch / Pi API key.
    #[tokio::test]
    #[ignore = "sends real requests to the configured Pi model"]
    async fn live_rpc_conversation_and_stop() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/rpc-smoke")
            .join(Uuid::new_v4().to_string());
        let project = root.join("中文 project");
        std::fs::create_dir_all(&project).unwrap();
        let (sender, mut events) = mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            let _ = sender.send(body.deserialize::<Value>().unwrap());
            Ok(())
        });
        let manager = PiManager::default();
        let snapshot = manager
            .connect(
                project.to_string_lossy().into(),
                &root.join("data"),
                channel.clone(),
            )
            .await
            .unwrap();
        let client = manager.client(&snapshot.instance_id).await.unwrap();
        let model = snapshot
            .models
            .iter()
            .find(|model| model.provider.starts_with("cc-switch"))
            .unwrap_or(&snapshot.models[0]);
        client
            .request(
                json!({"type":"set_model","provider":model.provider,"modelId":model.id}),
                None,
            )
            .await
            .unwrap();
        println!("Live provider/model: {}/{}", model.provider, model.id);

        let first_run = Uuid::new_v4().to_string();
        client.request(json!({"type":"prompt","message":"我们在进行客户端联调。请记住暗号 HEARTH-7C2，然后用中文介绍流式输出，分五个短段落。"}), Some(first_run.clone())).await.unwrap();
        let first = finished(&mut events, &first_run).await;
        let deltas = first
            .iter()
            .filter(|event| event["data"]["type"] == "message_delta")
            .count();
        assert!(deltas > 1, "expected multiple real stream deltas");
        assert_eq!(first.last().unwrap()["data"]["status"], "complete");
        println!("First response: {deltas} stream deltas, completed");

        let second_run = Uuid::new_v4().to_string();
        client
            .request(
                json!({"type":"prompt","message":"刚才要求你记住的暗号是什么？只输出暗号。"}),
                Some(second_run.clone()),
            )
            .await
            .unwrap();
        let second = finished(&mut events, &second_run).await;
        assert!(second.iter().any(|event| {
            event["data"]["type"] == "message_completed"
                && event["data"]["message"]["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("HEARTH-7C2"))
        }));
        println!("Second response: context retained");

        let third_run = Uuid::new_v4().to_string();
        client.request(json!({"type":"prompt","message":"逐行输出从 1 到 5000 的数字，每个数字单独一行，不要省略。"}), Some(third_run.clone())).await.unwrap();
        timeout(Duration::from_secs(60), async {
            loop {
                let event = events.recv().await.unwrap();
                if event["runId"] == third_run && event["data"]["type"] == "message_delta" {
                    break;
                }
            }
        })
        .await
        .unwrap();
        client
            .request(json!({"type":"clear_queue"}), None)
            .await
            .unwrap();
        client.request(json!({"type":"abort"}), None).await.unwrap();
        let third = finished(&mut events, &third_run).await;
        assert_eq!(third.last().unwrap()["data"]["status"], "cancelled");
        assert!(client.snapshot().await.unwrap().active_run_id.is_none());
        println!("Third response: stopped during streaming; session idle");
        manager.disconnect().await;
        assert!(client.snapshot().await.is_err());
        println!("Disconnect: managed process released");
    }
}
