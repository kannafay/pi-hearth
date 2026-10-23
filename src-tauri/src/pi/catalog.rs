use super::{
    client::{OpenOptions, PiManager},
    config::local_agent_directory,
    search::{IndexedDocument, SearchDocument, SearchIndex},
    storage::{self, Preferences},
    types::*,
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tauri::{Manager, State, ipc::Channel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, watch},
    time::timeout,
};

pub struct WorkspaceManager {
    gate: Mutex<()>,
    open_gate: Mutex<()>,
    opening: watch::Sender<u64>,
    search: Mutex<SearchIndex>,
}

impl Default for WorkspaceManager {
    fn default() -> Self {
        Self {
            gate: Mutex::new(()),
            open_gate: Mutex::new(()),
            opening: watch::channel(0).0,
            search: Mutex::new(SearchIndex::default()),
        }
    }
}

impl WorkspaceManager {
    pub fn cancel_open(&self) {
        self.opening.send_modify(|generation| *generation += 1);
    }

    fn begin_open(&self) -> (u64, watch::Receiver<u64>) {
        let mut request = 0;
        self.opening.send_modify(|generation| {
            *generation += 1;
            request = *generation;
        });
        (request, self.opening.subscribe())
    }
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用数据目录。".into())
}

async fn preferences(data: &Path) -> Result<Preferences, String> {
    storage::preferences(data).await
}

async fn save(data: &Path, preferences: &Preferences) -> Result<(), String> {
    storage::save_preferences(data, preferences).await
}

pub async fn helper(data: &Path, request: Value) -> Result<Value, String> {
    let runtime = data.join("runtime");
    tokio::fs::create_dir_all(&runtime)
        .await
        .map_err(|_| "无法创建会话适配器目录。")?;
    let helper_path = runtime.join("session-catalog.mjs");
    // Searching and opening may run together. Never truncate a script being started.
    static INSTALL: Mutex<()> = Mutex::const_new(());
    {
        let _install = INSTALL.lock().await;
        let source = include_str!("../../../runtime/session-catalog.mjs");
        if tokio::fs::read_to_string(&helper_path)
            .await
            .ok()
            .as_deref()
            != Some(source)
        {
            tokio::fs::write(&helper_path, source)
                .await
                .map_err(|_| "无法准备 Pi 会话适配器。")?;
        }
    }
    let sdk = dunce::canonicalize(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js"),
    )
    .map_err(|_| "缺少 Pi 运行时，请运行 pnpm install。")?;
    let mut command = Command::new("node");
    command
        .arg(helper_path)
        .arg(sdk)
        .env("PI_CODING_AGENT_DIR", local_agent_directory()?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动会话适配器，请检查 Node.js。")?;
    let mut stdin = child.stdin.take().ok_or("无法访问会话适配器。")?;
    stdin
        .write_all(&serde_json::to_vec(&request).unwrap())
        .await
        .map_err(|_| "无法发送会话请求。")?;
    drop(stdin);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let result = timeout(Duration::from_secs(30), async {
        let read = async {
            let mut bytes = vec![];
            stdout
                .take(64 * 1024 * 1024)
                .read_to_end(&mut bytes)
                .await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let errors = async {
            let mut bytes = vec![];
            stderr.take(8192).read_to_end(&mut bytes).await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let (bytes, diagnostic) = tokio::try_join!(read, errors)?;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, bytes, diagnostic))
    })
    .await;
    let (status, bytes, diagnostic) = result
        .map_err(|_| "读取 Pi 会话超时。")?
        .map_err(|_| "无法读取 Pi 会话。")?;
    if !status.success() {
        return Err(format!(
            "无法读取 Pi 会话：{}",
            String::from_utf8_lossy(&diagnostic)
        ));
    }
    serde_json::from_slice(&bytes).map_err(|_| "Pi 会话适配器返回了无效数据。".into())
}

async fn list(data: &Path, prefs: &Preferences) -> Result<Vec<SessionInfo>, String> {
    let value = helper(data, json!({"action":"list","legacyDir":data.join("sessions"),"projects":prefs.projects.iter().map(|project| &project.path).collect::<Vec<_>>()})).await?;
    serde_json::from_value(value).map_err(|_| "无法解析 Pi 会话列表。".into())
}

fn project(path: &Path) -> ProjectInfo {
    ProjectInfo {
        path: path.to_string_lossy().into(),
        name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into(),
    }
}

pub async fn load_catalog(data: &Path) -> Result<WorkspaceCatalog, String> {
    let prefs = preferences(data).await?;
    let general = data.join("workspace");
    tokio::fs::create_dir_all(&general)
        .await
        .map_err(|_| "无法创建普通对话工作目录。")?;
    let general = dunce::canonicalize(general).map_err(|_| "无法访问普通对话目录。")?;
    let sessions = list(data, &prefs).await?;
    let removed = storage::settings(data).await?.removed_projects;
    let mut projects = prefs.projects;
    projects.retain(|project| !removed.iter().any(|path| same_path(path, &project.path)));
    for session in &sessions {
        let path = Path::new(&session.cwd);
        if path.is_dir()
            && path != general
            && !removed.iter().any(|path| same_path(path, &session.cwd))
            && !projects
                .iter()
                .any(|project| same_path(&project.path, &session.cwd))
        {
            projects.push(project(path));
        }
    }
    Ok(WorkspaceCatalog {
        projects,
        sessions,
        general_cwd: general.to_string_lossy().into(),
        selection: prefs.selection,
        session_preferences: prefs.session_preferences,
    })
}

pub fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.replace('/', "\\")
            .eq_ignore_ascii_case(&b.replace('/', "\\"))
    } else {
        a == b
    }
}

pub fn session_key(path: &str) -> String {
    let path = path.replace('\\', "/");
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    }
}

fn update_session_preference(prefs: &mut Preferences, path: &str, preference: SessionPreference) {
    if preference.archived
        && prefs
            .selection
            .session_path
            .as_deref()
            .is_some_and(|selected| same_path(selected, path))
    {
        prefs.selection.session_path = None;
    }
    let key = session_key(path);
    if preference.pinned || preference.archived {
        prefs.session_preferences.insert(key, preference);
    } else {
        prefs.session_preferences.remove(&key);
    }
}

#[tauri::command]
pub async fn workspace_update_session(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    path: String,
    preference: SessionPreference,
) -> Result<HashMap<String, SessionPreference>, String> {
    let _lock = workspace.gate.lock().await;
    let data = app_data(&app)?;
    let mut prefs = preferences(&data).await?;
    let sessions = list(&data, &prefs).await?;
    let session = sessions
        .iter()
        .find(|session| same_path(&session.path, &path))
        .ok_or("会话文件不存在，请刷新列表。")?;
    update_session_preference(&mut prefs, &session.path, preference);
    save(&data, &prefs).await?;
    workspace.search.lock().await.catalog = None;
    Ok(prefs.session_preferences)
}

#[tauri::command]
pub async fn workspace_catalog(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
) -> Result<WorkspaceCatalog, String> {
    let _lock = workspace.gate.lock().await;
    load_catalog(&app_data(&app)?).await
}

async fn remove_project(data: &Path, path: &str) -> Result<(), String> {
    let mut prefs = preferences(data).await?;
    prefs
        .projects
        .retain(|project| !same_path(&project.path, path));
    if prefs
        .selection
        .project_path
        .as_deref()
        .is_some_and(|selected| same_path(selected, path))
    {
        prefs.selection = Selection::default();
    }
    let mut removed = storage::settings(data).await?.removed_projects;
    if !removed.iter().any(|item| same_path(item, path)) {
        removed.push(path.to_owned());
    }
    storage::save_projects(data, &prefs, removed).await
}

#[tauri::command]
pub async fn workspace_remove_project(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    path: String,
) -> Result<(), String> {
    let _lock = workspace.gate.lock().await;
    remove_project(&app_data(&app)?, &path).await?;
    workspace.search.lock().await.catalog = None;
    Ok(())
}

async fn delete_archived(
    data: &Path,
    prefs: &mut Preferences,
    sessions: &[SessionInfo],
    paths: &[String],
) -> Result<usize, String> {
    if paths.is_empty() {
        return Err("请先选择要删除的归档会话。".into());
    }
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    // Validate the whole selection before removing any native history files.
    for path in paths {
        if !seen.insert(session_key(path)) {
            continue;
        }
        let session = sessions
            .iter()
            .find(|session| same_path(&session.path, path))
            .ok_or("会话文件不存在，请刷新列表。")?;
        if !prefs
            .session_preferences
            .get(&session_key(&session.path))
            .is_some_and(|preference| preference.archived)
        {
            return Err("只能删除已归档的会话。".into());
        }
        selected.push(session);
    }
    let mut deleted = 0;
    let mut deleted_paths = Vec::new();
    let mut failed = 0;
    for session in selected {
        match tokio::fs::remove_file(&session.path).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                failed += 1;
                continue;
            }
        }
        prefs
            .session_preferences
            .remove(&session_key(&session.path));
        if prefs
            .selection
            .session_path
            .as_deref()
            .is_some_and(|path| same_path(path, &session.path))
        {
            prefs.selection.session_path = None;
        }
        deleted += 1;
        deleted_paths.push(session.path.clone());
    }
    if deleted > 0 {
        storage::save_preferences_and_remove_documents(data, prefs, deleted_paths).await?;
    }
    if failed > 0 {
        return Err(format!(
            "已删除 {deleted} 个会话，{failed} 个未能删除，请重试。"
        ));
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn workspace_delete_archived(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    paths: Vec<String>,
) -> Result<WorkspaceCatalog, String> {
    let _lock = workspace.gate.lock().await;
    let data = app_data(&app)?;
    let mut prefs = preferences(&data).await?;
    let sessions = list(&data, &prefs).await?;
    let result = delete_archived(&data, &mut prefs, &sessions, &paths).await;
    workspace.search.lock().await.catalog = None;
    result?;
    load_catalog(&data).await
}

#[tauri::command]
pub async fn workspace_search(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    query: String,
) -> Result<Vec<SessionSearchResult>, String> {
    if query.len() > 2048 {
        return Err("搜索关键词过长。".into());
    }
    let data = app_data(&app)?;
    let mut index = workspace.search.lock().await;
    if index
        .catalog
        .as_ref()
        .is_none_or(|(time, _)| time.elapsed() > Duration::from_secs(15))
    {
        let catalog = load_catalog(&data).await?;
        index
            .documents
            .retain(|file, _| catalog.sessions.iter().any(|session| &session.path == file));
        index.catalog = Some((Instant::now(), catalog));
    }
    if query.trim().is_empty() {
        return Ok(index.query(""));
    }
    if !index.persisted_loaded {
        index.documents = storage::search_documents(&data).await?;
        index.persisted_loaded = true;
    }
    let files: Vec<_> = index
        .catalog
        .as_ref()
        .unwrap()
        .1
        .sessions
        .iter()
        .map(|session| session.path.clone())
        .collect();
    let mut changed = Vec::new();
    let mut existing = Vec::new();
    for file in files {
        let Ok(meta) = tokio::fs::metadata(&file).await else {
            index.documents.remove(&file);
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        existing.push(file.clone());
        if index
            .documents
            .get(&file)
            .is_none_or(|document| document.modified != modified || document.size != meta.len())
        {
            changed.push((file, modified, meta.len()));
        }
    }
    let mut updates = HashMap::new();
    if !changed.is_empty() {
        let documents: Vec<SearchDocument> = serde_json::from_value(helper(&data, json!({"action":"search_documents", "paths": changed.iter().map(|(file, _, _)| file).collect::<Vec<_>>()})).await?).map_err(|_| "无法建立会话搜索索引。")?;
        for document in documents {
            if let Some((_, modified, size)) =
                changed.iter().find(|(file, _, _)| file == &document.path)
            {
                let indexed = IndexedDocument {
                    modified: *modified,
                    size: *size,
                    texts: document.texts,
                };
                updates.insert(document.path.clone(), indexed.clone());
                index.documents.insert(document.path, indexed);
            }
        }
    }
    index.documents.retain(|path, _| existing.contains(path));
    storage::save_search_documents(&data, updates, existing).await?;
    Ok(index.query(&query))
}

#[tauri::command]
pub async fn workspace_select(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    selection: Selection,
) -> Result<(), String> {
    let _lock = workspace.gate.lock().await;
    let data = app_data(&app)?;
    let mut prefs = preferences(&data).await?;
    prefs.selection = selection;
    save(&data, &prefs).await
}

#[tauri::command]
pub fn workspace_project_directory(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<String, String> {
    let directory = match path {
        Some(path) => existing_project_directory(Path::new(&path))?,
        None => default_projects_directory(&app)?,
    };
    Ok(directory.to_string_lossy().into())
}

fn default_projects_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|path| path.join("Pi Hearth").join("Projects"))
        .map_err(|_| "无法定位文档目录，请在设置中选择项目保存位置。".into())
}

fn existing_project_directory(path: &Path) -> Result<PathBuf, String> {
    let directory = dunce::canonicalize(path).map_err(|_| "项目目录不存在或无法访问。")?;
    if !directory.is_dir() {
        return Err("请添加文件夹，而不是文件。".into());
    }
    Ok(directory)
}

#[tauri::command]
pub fn workspace_open_project_folder(path: String) -> Result<(), String> {
    let directory = existing_project_directory(Path::new(&path))?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let directory: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                directory.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        } as isize;
        if result <= 32 {
            return Err("无法在资源管理器中打开项目文件夹。".into());
        }
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        })
        .arg(directory)
        .spawn()
        .map_err(|_| "无法在文件管理器中打开项目文件夹。")?;
    }
    Ok(())
}

async fn prepare_project(
    source: Option<&str>,
    name: Option<&str>,
    parent: &Path,
) -> Result<ProjectInfo, String> {
    let name = name.map(str::trim).filter(|name| !name.is_empty());
    if name.is_some_and(|name| name.chars().count() > 128 || name.chars().any(char::is_control)) {
        return Err("项目名称不能包含控制字符，且不能超过 128 个字符。".into());
    }
    let directory = if let Some(source) = source {
        existing_project_directory(Path::new(source))?
    } else {
        name.ok_or("未添加源文件夹时，请填写项目名称。")?;
        if !parent.is_absolute() {
            return Err("项目保存目录必须是绝对路径。".into());
        }
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| "无法创建项目保存目录，请在设置中更改保存位置。")?;
        let directory = existing_project_directory(parent)?.join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir(&directory)
            .await
            .map_err(|_| "无法创建项目目录，请检查保存位置是否可写。")?;
        directory
    };
    let mut project = project(&directory);
    if let Some(name) = name {
        project.name = name.into();
    }
    Ok(project)
}

#[tauri::command]
pub async fn workspace_add_project(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    source_path: Option<String>,
    name: Option<String>,
    parent_path: Option<String>,
    instructions: Option<String>,
    expected_instructions: Option<String>,
) -> Result<ProjectInfo, String> {
    let _lock = workspace.gate.lock().await;
    let data = app_data(&app)?;
    let parent = if source_path.is_some() {
        PathBuf::new()
    } else {
        let parent = match parent_path {
            Some(path) => path,
            None => storage::settings(&data).await?.projects_directory,
        };
        if parent.is_empty() {
            default_projects_directory(&app)?
        } else {
            PathBuf::from(parent)
        }
    };
    let project = prepare_project(source_path.as_deref(), name.as_deref(), &parent).await?;
    let project = save_project(&data, project, instructions, expected_instructions).await?;
    workspace.search.lock().await.catalog = None;
    Ok(project)
}

#[tauri::command]
pub async fn workspace_update_project(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceManager>,
    path: String,
    name: Option<String>,
    instructions: Option<String>,
    expected_instructions: Option<String>,
) -> Result<ProjectInfo, String> {
    let _lock = workspace.gate.lock().await;
    let data = app_data(&app)?;
    let project = prepare_project(Some(&path), name.as_deref(), Path::new("")).await?;
    let project = save_project(&data, project, instructions, expected_instructions).await?;
    workspace.search.lock().await.catalog = None;
    Ok(project)
}

async fn save_project(
    data: &Path,
    project: ProjectInfo,
    instructions: Option<String>,
    expected_instructions: Option<String>,
) -> Result<ProjectInfo, String> {
    if instructions.is_some() {
        project_instructions(project.path.clone(), instructions, expected_instructions).await?;
    }
    let mut prefs = preferences(data).await?;
    if let Some(existing) = prefs
        .projects
        .iter_mut()
        .find(|item| same_path(&item.path, &project.path))
    {
        *existing = project.clone();
    } else {
        prefs.projects.push(project.clone());
    }
    let mut removed = storage::settings(data).await?.removed_projects;
    removed.retain(|path| !same_path(path, &project.path));
    storage::save_projects(data, &prefs, removed).await?;
    Ok(project)
}

#[tauri::command]
pub async fn project_instructions(
    path: String,
    content: Option<String>,
    expected: Option<String>,
) -> Result<ProjectInstructions, String> {
    let root = dunce::canonicalize(path).map_err(|_| "项目目录不存在。")?;
    if !root.is_dir() {
        return Err("无效的项目目录。".into());
    }
    let agents = root.join("AGENTS.md");
    let target = if !agents.exists() && root.join("CLAUDE.md").is_file() {
        root.join("CLAUDE.md")
    } else {
        agents
    };
    let current = match tokio::fs::read_to_string(&target).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err("无法读取项目指令文件。".into()),
    };
    if let Some(content) = content {
        if content.len() > 256 * 1024 {
            return Err("项目指令过长，请限制在 256 KiB 内。".into());
        }
        if expected.as_deref() != Some(&current) {
            return Err("指令文件已被其他程序修改，请重新打开后编辑。".into());
        }
        tokio::fs::write(&target, &content)
            .await
            .map_err(|_| "无法保存项目指令。")?;
        Ok(ProjectInstructions {
            path: target.to_string_lossy().into(),
            content,
        })
    } else {
        Ok(ProjectInstructions {
            path: target.to_string_lossy().into(),
            content: current,
        })
    }
}

#[tauri::command]
pub async fn pi_open(
    app: tauri::AppHandle,
    manager: State<'_, PiManager>,
    workspace: State<'_, WorkspaceManager>,
    project_path: Option<String>,
    session_path: Option<String>,
    on_event: Channel<PiEvent>,
) -> Result<RuntimeSnapshot, String> {
    let (request, mut cancelled) = workspace.begin_open();
    let operation = async {
        let _open_lock = workspace.open_gate.lock().await;
        let data = app_data(&app)?;
        let (cwd, history, session_id) = if let Some(file) = &session_path {
            let catalog = load_catalog(&data).await?;
            let session = catalog
                .sessions
                .iter()
                .find(|session| same_path(&session.path, file))
                .ok_or("会话文件不存在，请刷新列表。")?;
            (
                session.cwd.clone(),
                helper(&data, json!({"action":"history","path":session.path})).await?,
                session.id.clone(),
            )
        } else {
            let general = data.join("workspace");
            tokio::fs::create_dir_all(&general)
                .await
                .map_err(|_| "无法创建聊天目录。")?;
            (
                project_path
                    .clone()
                    .unwrap_or_else(|| general.to_string_lossy().into()),
                json!([]),
                String::new(),
            )
        };
        let history: Vec<Value> =
            serde_json::from_value(history).map_err(|_| "无法加载会话消息。")?;
        let snapshot = if !Path::new(&cwd).is_dir() {
            manager
                .open_read_only(
                    cwd,
                    session_id,
                    session_path.clone().ok_or("工作目录不存在。")?,
                    history,
                    &data,
                )
                .await?
        } else {
            let existing_directory = if session_path.is_none() {
                manager.session_directory(&cwd).await
            } else {
                None
            };
            let session_dir = match existing_directory {
                Some(directory) => directory,
                None => {
                    let directory: String = serde_json::from_value(
                        helper(&data, json!({"action":"directory","cwd":cwd})).await?,
                    )
                    .map_err(|_| "无法定位 Pi 会话目录。")?;
                    directory.into()
                }
            };
            manager
                .open(
                    cwd,
                    &data,
                    on_event,
                    OpenOptions {
                        session_directory: session_dir,
                        session_file: session_path,
                        history,
                    },
                )
                .await?
        };
        let _lock = workspace.gate.lock().await;
        let mut prefs = preferences(&data).await?;
        prefs.selection = Selection {
            project_path,
            session_path: snapshot.session_file.clone().filter(|path| {
                !prefs
                    .session_preferences
                    .get(&session_key(path))
                    .is_some_and(|entry| entry.archived)
            }),
        };
        save(&data, &prefs).await?;
        Ok(snapshot)
    };
    tokio::select! {
        biased;
        _ = cancelled.wait_for(|generation| *generation != request) => Err("已切换到其他会话。".into()),
        result = timeout(Duration::from_secs(45), operation) => result.unwrap_or_else(|_| Err("连接超时，请重试；也可以从侧栏打开其他会话。".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn archived_fixture() -> (PathBuf, Preferences, Vec<SessionInfo>) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/archive-delete-test")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&root).await.unwrap();
        let mut prefs = Preferences::default();
        let mut sessions = Vec::new();
        for index in 0..3 {
            let file = root.join(format!("{index}.jsonl"));
            tokio::fs::write(&file, "native history\n").await.unwrap();
            let path = file.to_string_lossy().into_owned();
            prefs.session_preferences.insert(
                session_key(&path),
                SessionPreference {
                    archived: index < 2,
                    pinned: true,
                },
            );
            sessions.push(SessionInfo {
                path,
                id: index.to_string(),
                cwd: root.to_string_lossy().into_owned(),
                title: format!("session {index}"),
                modified: 1,
                message_count: 1,
            });
        }
        save(&root, &prefs).await.unwrap();
        (root, prefs, sessions)
    }

    #[tokio::test]
    async fn removing_projects_preserves_sources_and_history_and_can_be_added_again() {
        let (data, mut prefs, sessions) = archived_fixture().await;
        let source = data.join("source");
        tokio::fs::create_dir_all(&source).await.unwrap();
        let file = source.join("keep.txt");
        tokio::fs::write(&file, "keep source files").await.unwrap();
        let path = source.to_string_lossy().into_owned();
        prefs.projects.push(ProjectInfo {
            path: path.clone(),
            name: "Custom name".into(),
        });
        prefs.selection = Selection {
            project_path: Some(path.clone()),
            session_path: Some(sessions[0].path.clone()),
        };
        save(&data, &prefs).await.unwrap();
        remove_project(&data, &path).await.unwrap();
        let saved = preferences(&data).await.unwrap();
        assert!(saved.projects.is_empty());
        assert!(saved.selection.project_path.is_none());
        assert!(saved.selection.session_path.is_none());
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "keep source files"
        );
        assert!(
            sessions
                .iter()
                .all(|session| Path::new(&session.path).is_file())
        );
        assert_eq!(
            storage::settings(&data).await.unwrap().removed_projects,
            [path.clone()]
        );
        storage::save_projects(&data, &prefs, Vec::new())
            .await
            .unwrap();
        assert_eq!(
            preferences(&data).await.unwrap().projects[0].name,
            "Custom name"
        );
        assert!(
            storage::settings(&data)
                .await
                .unwrap()
                .removed_projects
                .is_empty()
        );
    }

    #[tokio::test]
    async fn archived_deletion_removes_only_selected_histories_and_preferences() {
        let (root, mut prefs, sessions) = archived_fixture().await;
        prefs.selection.session_path = Some(sessions[0].path.clone());
        let paths = vec![
            sessions[0].path.clone(),
            sessions[1].path.clone(),
            sessions[0].path.clone(),
        ];
        assert_eq!(
            delete_archived(&root, &mut prefs, &sessions, &paths)
                .await
                .unwrap(),
            2
        );
        assert!(!Path::new(&sessions[0].path).exists());
        assert!(!Path::new(&sessions[1].path).exists());
        assert_eq!(
            tokio::fs::read_to_string(&sessions[2].path).await.unwrap(),
            "native history\n"
        );
        let saved = preferences(&root).await.unwrap();
        assert!(saved.selection.session_path.is_none());
        assert_eq!(saved.session_preferences.len(), 1);
        assert!(saved.session_preferences[&session_key(&sessions[2].path)].pinned);
    }

    #[tokio::test]
    async fn archived_deletion_validates_all_paths_before_removing_any_history() {
        let (root, mut prefs, sessions) = archived_fixture().await;
        let unknown = root.join("unknown.jsonl");
        tokio::fs::write(&unknown, "unlisted history")
            .await
            .unwrap();
        let unknown = unknown.to_string_lossy().into_owned();
        for rejected in [sessions[2].path.clone(), unknown.clone()] {
            assert!(
                delete_archived(
                    &root,
                    &mut prefs,
                    &sessions,
                    &[sessions[0].path.clone(), rejected]
                )
                .await
                .is_err()
            );
            assert!(Path::new(&sessions[0].path).is_file());
        }
        assert!(Path::new(&unknown).is_file());
        assert!(
            delete_archived(&root, &mut prefs, &sessions, &[])
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn archived_deletion_preserves_failed_entries_and_reports_partial_completion() {
        let (root, mut prefs, sessions) = archived_fixture().await;
        // Simulate a target being replaced after catalog discovery.
        tokio::fs::remove_file(&sessions[1].path).await.unwrap();
        tokio::fs::create_dir(&sessions[1].path).await.unwrap();
        let error = delete_archived(
            &root,
            &mut prefs,
            &sessions,
            &[sessions[0].path.clone(), sessions[1].path.clone()],
        )
        .await
        .unwrap_err();
        assert!(error.contains("已删除 1 个会话，1 个未能删除"));
        assert!(!Path::new(&sessions[0].path).exists());
        assert!(Path::new(&sessions[1].path).is_dir());
        let saved = preferences(&root).await.unwrap();
        assert!(
            !saved
                .session_preferences
                .contains_key(&session_key(&sessions[0].path))
        );
        assert!(saved.session_preferences[&session_key(&sessions[1].path)].archived);
    }

    #[tokio::test]
    async fn session_preferences_persist_without_modifying_native_history() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/session-preferences-test")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&root).await.unwrap();
        let history = root.join("chat.jsonl");
        let original = "{\"type\":\"session\",\"id\":\"original\"}\n";
        tokio::fs::write(&history, original).await.unwrap();
        let path = history.to_string_lossy().into_owned();
        let mut prefs: Preferences =
            serde_json::from_str(r#"{"projects":[],"selection":{}}"#).unwrap();
        assert!(prefs.session_preferences.is_empty());
        prefs.selection.session_path = Some(path.clone());
        update_session_preference(
            &mut prefs,
            &path,
            SessionPreference {
                pinned: true,
                archived: true,
            },
        );
        save(&root, &prefs).await.unwrap();
        let mut restored = preferences(&root).await.unwrap();
        assert!(restored.selection.session_path.is_none());
        assert!(restored.session_preferences[&session_key(&path)].pinned);
        assert!(restored.session_preferences[&session_key(&path)].archived);
        update_session_preference(
            &mut restored,
            &path,
            SessionPreference {
                pinned: true,
                archived: false,
            },
        );
        assert!(!restored.session_preferences[&session_key(&path)].archived);
        save(&root, &restored).await.unwrap();
        assert!(
            !preferences(&root).await.unwrap().session_preferences[&session_key(&path)].archived
        );
        update_session_preference(&mut restored, &path, SessionPreference::default());
        assert!(restored.session_preferences.is_empty());
        save(&root, &restored).await.unwrap();
        assert!(
            preferences(&root)
                .await
                .unwrap()
                .session_preferences
                .is_empty()
        );
        assert_eq!(tokio::fs::read_to_string(history).await.unwrap(), original);
    }
    #[tokio::test]
    async fn a_new_open_cancels_previous_and_queued_requests() {
        let workspace = WorkspaceManager::default();
        let (first, mut cancelled) = workspace.begin_open();
        let (second, mut second_cancelled) = workspace.begin_open();
        cancelled
            .wait_for(|generation| *generation != first)
            .await
            .unwrap();
        assert_eq!(*second_cancelled.borrow(), second);
        workspace.begin_open();
        second_cancelled
            .wait_for(|generation| *generation != second)
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn display_names_cannot_determine_new_project_paths() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-create-test")
            .join(uuid::Uuid::new_v4().to_string());
        for name in ["../x", "CON", "设计讨论：前端/体验", "x."] {
            let created = prepare_project(None, Some(name), &root).await.unwrap();
            assert_eq!(created.name, name);
            let directory = Path::new(&created.path);
            assert_eq!(
                directory.parent().unwrap(),
                dunce::canonicalize(&root).unwrap()
            );
            assert!(
                uuid::Uuid::parse_str(directory.file_name().unwrap().to_str().unwrap()).is_ok()
            );
        }
    }

    #[tokio::test]
    async fn project_without_source_requires_a_name_and_creates_under_the_save_location() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-create-test")
            .join(uuid::Uuid::new_v4().to_string());
        assert!(prepare_project(None, None, &root).await.is_err());
        assert!(!root.exists());
        for name in ["  ".to_string(), "bad\nname".to_string(), "x".repeat(129)] {
            assert!(prepare_project(None, Some(&name), &root).await.is_err());
        }
        assert!(!root.exists());
        let created = prepare_project(None, Some("新项目"), &root).await.unwrap();
        assert_eq!(created.name, "新项目");
        let directory = Path::new(&created.path);
        assert_eq!(
            directory.parent().unwrap(),
            dunce::canonicalize(&root).unwrap()
        );
        assert!(uuid::Uuid::parse_str(directory.file_name().unwrap().to_str().unwrap()).is_ok());
        assert!(!root.join("新项目").exists());
        let marker = directory.join("keep.txt");
        tokio::fs::write(&marker, "existing project").await.unwrap();
        let second = prepare_project(None, Some("新项目"), &root).await.unwrap();
        assert_ne!(created.path, second.path);
        assert_eq!(created.name, second.name);
        save_project(&root, created.clone(), None, None)
            .await
            .unwrap();
        save_project(&root, second.clone(), None, None)
            .await
            .unwrap();
        let persisted = preferences(&root).await.unwrap().projects;
        assert_eq!(persisted.len(), 2);
        assert_eq!(persisted[0].path, created.path);
        assert_eq!(persisted[1].path, second.path);
        assert!(persisted.iter().all(|project| project.name == "新项目"));
        assert_eq!(
            tokio::fs::read_to_string(marker).await.unwrap(),
            "existing project"
        );
    }

    #[tokio::test]
    async fn project_names_are_independent_from_existing_source_directories_and_persist() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-source-test")
            .join(uuid::Uuid::new_v4().to_string());
        let source = root.join("source");
        tokio::fs::create_dir_all(&source).await.unwrap();
        let alias = "设计讨论：前端/体验";
        let added = prepare_project(
            Some(source.to_str().unwrap()),
            Some(alias),
            Path::new("unused"),
        )
        .await
        .unwrap();
        assert_eq!(added.name, alias);
        assert_eq!(
            Path::new(&added.path),
            dunce::canonicalize(&source).unwrap()
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 0);
        let prefs = Preferences {
            projects: vec![added],
            ..Default::default()
        };
        save(&root, &prefs).await.unwrap();
        assert_eq!(preferences(&root).await.unwrap().projects[0].name, alias);
        let inferred = prepare_project(
            Some(source.to_str().unwrap()),
            Some("  "),
            Path::new("unused"),
        )
        .await
        .unwrap();
        assert_eq!(inferred.name, "source");
    }

    #[tokio::test]
    async fn project_sources_reject_files_and_missing_directories() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-source-test")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&root).await.unwrap();
        let file = root.join("notes.txt");
        tokio::fs::write(&file, "keep").await.unwrap();
        assert!(
            existing_project_directory(&file)
                .unwrap_err()
                .contains("而不是文件")
        );
        assert!(existing_project_directory(&root.join("missing")).is_err());
        assert_eq!(tokio::fs::read_to_string(file).await.unwrap(), "keep");
    }

    #[tokio::test]
    async fn project_settings_save_name_and_rules_without_moving_the_source() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-settings-test")
            .join(uuid::Uuid::new_v4().to_string());
        let created = prepare_project(None, Some("source"), &root).await.unwrap();
        let source = PathBuf::from(&created.path);
        let rules = source.join("AGENTS.md");
        save_project(
            &root,
            created.clone(),
            Some("Original rules".into()),
            Some(String::new()),
        )
        .await
        .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&rules).await.unwrap(),
            "Original rules"
        );
        let renamed = prepare_project(Some(&created.path), Some("New name"), Path::new(""))
            .await
            .unwrap();
        let saved = save_project(
            &root,
            renamed,
            Some("New rules".into()),
            Some("Original rules".into()),
        )
        .await
        .unwrap();
        assert_eq!(saved.path, created.path);
        assert!(uuid::Uuid::parse_str(source.file_name().unwrap().to_str().unwrap()).is_ok());
        assert_eq!(
            tokio::fs::read_to_string(&rules).await.unwrap(),
            "New rules"
        );
        let prefs = preferences(&root).await.unwrap();
        assert_eq!(prefs.projects.len(), 1);
        assert_eq!(prefs.projects[0].name, "New name");

        tokio::fs::write(&rules, "External rules").await.unwrap();
        let mut conflicting = saved;
        conflicting.name = "Must not be saved".into();
        assert!(
            save_project(
                &root,
                conflicting,
                Some("Stale edit".into()),
                Some("New rules".into())
            )
            .await
            .is_err()
        );
        assert_eq!(
            preferences(&root).await.unwrap().projects[0].name,
            "New name"
        );
        assert_eq!(
            tokio::fs::read_to_string(&rules).await.unwrap(),
            "External rules"
        );
    }

    #[tokio::test]
    async fn existing_project_rules_are_untouched_by_name_only_saves() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-settings-test")
            .join(uuid::Uuid::new_v4().to_string());
        let source = root.join("source");
        tokio::fs::create_dir_all(&source).await.unwrap();
        let file = source.join("CLAUDE.md");
        tokio::fs::write(&file, "Existing shared rules")
            .await
            .unwrap();
        let project = prepare_project(Some(source.to_str().unwrap()), Some("Alias"), Path::new(""))
            .await
            .unwrap();
        save_project(&root, project.clone(), None, None)
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "Existing shared rules"
        );
        assert!(!source.join("AGENTS.md").exists());
        save_project(
            &root,
            project,
            Some("Updated shared rules".into()),
            Some("Existing shared rules".into()),
        )
        .await
        .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "Updated shared rules"
        );
        assert!(!source.join("AGENTS.md").exists());
    }

    #[tokio::test]
    async fn project_instructions_preserve_existing_rules_and_reject_external_changes() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-test")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&root).await.unwrap();
        let file = root.join("AGENTS.md");
        tokio::fs::write(&file, "existing rules").await.unwrap();
        let original = project_instructions(root.to_string_lossy().into(), None, None)
            .await
            .unwrap();
        assert_eq!(original.content, "existing rules");
        tokio::fs::write(&file, "external update").await.unwrap();
        assert!(
            project_instructions(
                root.to_string_lossy().into(),
                Some("new".into()),
                Some(original.content)
            )
            .await
            .is_err()
        );
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "external update"
        );
        project_instructions(
            root.to_string_lossy().into(),
            Some("confirmed rules".into()),
            Some("external update".into()),
        )
        .await
        .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&file).await.unwrap(),
            "confirmed rules"
        );
    }
}
