use super::{
    search::IndexedDocument,
    types::{AppSettings, AppSettingsPatch, ProjectInfo, Selection, SessionPreference},
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{Duration, UNIX_EPOCH},
};

const SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct Preferences {
    pub projects: Vec<ProjectInfo>,
    pub selection: Selection,
    pub session_preferences: HashMap<String, SessionPreference>,
}

fn database_error(error: impl std::fmt::Display) -> String {
    format!("无法访问应用数据库：{error}")
}

fn open(data: &Path) -> Result<Connection, String> {
    // WAL setup cannot run concurrently, even when SQLite's busy handler is enabled.
    static INITIALIZE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _initialize = INITIALIZE.lock().map_err(database_error)?;
    std::fs::create_dir_all(data).map_err(database_error)?;
    let mut connection = Connection::open(data.join("app.db")).map_err(database_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(database_error)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(database_error)?;
    if version > SCHEMA_VERSION {
        return Err("应用数据库由更新版本创建，请更新 App 后再打开。".into());
    }
    let journal: String = connection
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .map_err(database_error)?;
    if journal != "wal" {
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(database_error)?;
    }
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(database_error)?;
    if version == 0 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        // Another startup request may have completed migration while we waited.
        let version: i64 = transaction
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(database_error)?;
        if version == 0 {
            let legacy = match std::fs::read(data.join("workspace.json")) {
                Ok(bytes) => serde_json::from_slice::<Preferences>(&bytes)
                    .map_err(|_| "工作台配置损坏，请检查 workspace.json；原文件未修改。")?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Preferences::default()
                }
                Err(error) => return Err(format!("无法导入工作台配置：{error}")),
            };
            transaction
                .execute_batch(
                    "CREATE TABLE projects (
                        position INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL
                    );
                    CREATE TABLE workspace_selection (
                        id INTEGER PRIMARY KEY CHECK (id = 1), project_path TEXT, session_path TEXT
                    );
                    CREATE TABLE session_preferences (
                        path TEXT PRIMARY KEY, pinned INTEGER NOT NULL, archived INTEGER NOT NULL
                    );
                    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE search_documents (
                        path TEXT PRIMARY KEY, modified_secs INTEGER NOT NULL,
                        modified_nanos INTEGER NOT NULL, size INTEGER NOT NULL, texts TEXT NOT NULL
                    );",
                )
                .map_err(database_error)?;
            write_preferences(&transaction, &legacy)?;
            write_settings(
                &transaction,
                &serde_json::to_value(AppSettings::default()).unwrap(),
            )?;
            transaction
                .pragma_update(None, "user_version", SCHEMA_VERSION)
                .map_err(database_error)?;
        } else if version != SCHEMA_VERSION {
            return Err("应用数据库版本不兼容，请更新 App。".into());
        }
        transaction.commit().map_err(database_error)?;
    }
    Ok(connection)
}

async fn with_database<T: Send + 'static>(
    data: &Path,
    operation: impl FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let data = data.to_owned();
    tokio::task::spawn_blocking(move || operation(&mut open(&data)?))
        .await
        .map_err(|_| "应用数据库任务未能完成。")?
}

fn write_preferences(connection: &Connection, preferences: &Preferences) -> Result<(), String> {
    connection
        .execute_batch("DELETE FROM projects; DELETE FROM session_preferences;")
        .map_err(database_error)?;
    let mut insert = connection
        .prepare("INSERT INTO projects (position, path, name) VALUES (?1, ?2, ?3)")
        .map_err(database_error)?;
    for (position, project) in preferences.projects.iter().enumerate() {
        insert
            .execute(params![position as i64, project.path, project.name])
            .map_err(database_error)?;
    }
    connection
        .execute(
            "INSERT INTO workspace_selection (id, project_path, session_path) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET project_path=excluded.project_path, session_path=excluded.session_path",
            params![preferences.selection.project_path, preferences.selection.session_path],
        )
        .map_err(database_error)?;
    let mut insert = connection
        .prepare("INSERT INTO session_preferences (path, pinned, archived) VALUES (?1, ?2, ?3)")
        .map_err(database_error)?;
    for (path, preference) in &preferences.session_preferences {
        insert
            .execute(params![path, preference.pinned, preference.archived])
            .map_err(database_error)?;
    }
    Ok(())
}

pub(super) async fn preferences(data: &Path) -> Result<Preferences, String> {
    with_database(data, |connection| {
        // Keep the three tables in one snapshot when a save runs concurrently.
        let transaction = connection.transaction().map_err(database_error)?;
        read_preferences(&transaction)
    })
    .await
}

fn read_preferences(connection: &Connection) -> Result<Preferences, String> {
    let projects = connection
        .prepare("SELECT path, name FROM projects ORDER BY position")
        .map_err(database_error)?
        .query_map([], |row| {
            Ok(ProjectInfo {
                path: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    let selection = connection
        .query_row(
            "SELECT project_path, session_path FROM workspace_selection WHERE id=1",
            [],
            |row| {
                Ok(Selection {
                    project_path: row.get(0)?,
                    session_path: row.get(1)?,
                })
            },
        )
        .map_err(database_error)?;
    let session_preferences = connection
        .prepare("SELECT path, pinned, archived FROM session_preferences")
        .map_err(database_error)?
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                SessionPreference {
                    pinned: row.get(1)?,
                    archived: row.get(2)?,
                },
            ))
        })
        .map_err(database_error)?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(database_error)?;
    Ok(Preferences {
        projects,
        selection,
        session_preferences,
    })
}

pub(crate) fn relocate_data_paths(
    data: &Path,
    legacy: &Path,
    destination: &Path,
) -> Result<(), String> {
    if !data.join("app.db").exists() && !data.join("workspace.json").exists() {
        return Ok(());
    }
    let relocate = |path: &str| crate::app_data::relocate_path(path, legacy, destination);
    let mut connection = open(data)?;
    let transaction = connection.transaction().map_err(database_error)?;
    relocate_references(&transaction, &relocate)?;
    transaction.commit().map_err(database_error)
}

fn relocate_references(
    transaction: &Connection,
    relocate: &impl Fn(&str) -> String,
) -> Result<(), String> {
    let mut preferences = read_preferences(&transaction)?;
    for project in &mut preferences.projects {
        project.path = relocate(&project.path);
    }
    preferences.selection.project_path = preferences
        .selection
        .project_path
        .map(|path| relocate(&path));
    preferences.selection.session_path = preferences
        .selection
        .session_path
        .map(|path| relocate(&path));
    let old_preferences = std::mem::take(&mut preferences.session_preferences);
    for (path, preference) in old_preferences {
        let path = super::catalog::session_key(&relocate(&path));
        let entry = preferences.session_preferences.entry(path).or_default();
        entry.pinned |= preference.pinned;
        entry.archived |= preference.archived;
    }
    write_preferences(&transaction, &preferences)?;

    let rows = transaction
        .prepare("SELECT key, value FROM app_settings")
        .map_err(database_error)?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    let mut settings = serde_json::Map::new();
    for (key, value) in rows {
        let mut value: serde_json::Value = serde_json::from_str(&value).map_err(database_error)?;
        relocate_json_paths(&mut value, &relocate);
        if key == "expandedProjects"
            && let Some(projects) = value.as_object_mut()
        {
            *projects = std::mem::take(projects)
                .into_iter()
                .map(|(path, expanded)| (super::catalog::session_key(&relocate(&path)), expanded))
                .collect();
        }
        settings.insert(key, value);
    }
    write_settings(&transaction, &settings.into())?;
    // Rebuild the derived search index against the renamed native history files.
    transaction
        .execute("DELETE FROM search_documents", [])
        .map_err(database_error)?;
    Ok(())
}

pub(super) fn save_project_location(
    data: &Path,
    patch: AppSettingsPatch,
    paths: &[super::types::PathRelocation],
) -> Result<(AppSettings, Preferences), String> {
    let mut connection = open(data)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    relocate_references(&transaction, &|path| {
        super::project_location::relocate(path, paths)
    })?;
    write_settings(
        &transaction,
        &serde_json::to_value(patch).map_err(database_error)?,
    )?;
    let settings = read_settings(&transaction)?;
    let preferences = read_preferences(&transaction)?;
    transaction.commit().map_err(database_error)?;
    Ok((settings, preferences))
}

fn relocate_json_paths(value: &mut serde_json::Value, relocate: &impl Fn(&str) -> String) {
    match value {
        serde_json::Value::String(path) => *path = relocate(path),
        serde_json::Value::Array(values) => {
            for value in values {
                relocate_json_paths(value, relocate);
            }
        }
        serde_json::Value::Object(values) => {
            for value in values.values_mut() {
                relocate_json_paths(value, relocate);
            }
        }
        _ => {}
    }
}

pub(super) async fn save_preferences(data: &Path, preferences: &Preferences) -> Result<(), String> {
    save_preferences_and_remove_documents(data, preferences, Vec::new()).await
}

pub(super) async fn save_projects(
    data: &Path,
    preferences: &Preferences,
    removed_projects: Vec<String>,
) -> Result<(), String> {
    let preferences = preferences.clone();
    with_database(data, move |connection| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        write_preferences(&transaction, &preferences)?;
        write_settings(
            &transaction,
            &serde_json::json!({"removedProjects": removed_projects}),
        )?;
        transaction.commit().map_err(database_error)
    })
    .await
}

pub(super) async fn save_preferences_and_remove_documents(
    data: &Path,
    preferences: &Preferences,
    removed: Vec<String>,
) -> Result<(), String> {
    let preferences = preferences.clone();
    with_database(data, move |connection| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        write_preferences(&transaction, &preferences)?;
        for path in removed {
            transaction
                .execute("DELETE FROM search_documents WHERE path=?1", [path])
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)
    })
    .await
}

fn read_settings(connection: &Connection) -> Result<AppSettings, String> {
    let rows = connection
        .prepare("SELECT key, value FROM app_settings")
        .map_err(database_error)?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    let mut values = serde_json::Map::new();
    for (key, value) in rows {
        values.insert(key, serde_json::from_str(&value).map_err(database_error)?);
    }
    let settings: AppSettings = serde_json::from_value(values.into()).map_err(database_error)?;
    if let Some(proxy) = &settings.proxy {
        super::network::validate(proxy)?;
    }
    if settings
        .default_model
        .as_ref()
        .is_some_and(|model| model.provider.trim().is_empty() || model.id.trim().is_empty())
    {
        return Err("请选择有效的默认模型。".into());
    }
    if [
        &settings.projects_directory,
        &settings.custom_projects_directory,
        &settings.files_directory,
        &settings.custom_files_directory,
    ]
    .iter()
    .any(|directory| !directory.is_empty() && !Path::new(directory).is_absolute())
    {
        return Err("保存目录必须是绝对路径。".into());
    }
    if !settings.navigation_width.is_finite()
        || !(220.0..=400.0).contains(&settings.navigation_width)
        || !settings.inspector_width.is_finite()
        || !(300.0..=560.0).contains(&settings.inspector_width)
    {
        return Err("无效的面板宽度设置。".into());
    }
    if settings.thinking_level.as_deref().is_some_and(|level| {
        !["default", "off", "low", "medium", "high", "xhigh", "max"].contains(&level)
    }) {
        return Err("无效的思考档位设置。".into());
    }
    Ok(settings)
}

fn write_settings(connection: &Connection, settings: &serde_json::Value) -> Result<(), String> {
    let mut insert = connection
        .prepare("INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .map_err(database_error)?;
    for (key, value) in settings.as_object().ok_or("无效的应用设置。")? {
        insert
            .execute(params![key, value.to_string()])
            .map_err(database_error)?;
    }
    Ok(())
}

pub(crate) async fn settings(data: &Path) -> Result<AppSettings, String> {
    with_database(data, |connection| read_settings(connection)).await
}

pub(super) async fn update_settings(
    data: &Path,
    patch: AppSettingsPatch,
) -> Result<AppSettings, String> {
    with_database(data, move |connection| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        write_settings(
            &transaction,
            &serde_json::to_value(patch).map_err(database_error)?,
        )?;
        let settings = read_settings(&transaction)?;
        transaction.commit().map_err(database_error)?;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub async fn app_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let data = crate::app_data::directory(&app)?;
    settings(&data).await
}

#[tauri::command]
pub async fn app_update_settings(
    app: tauri::AppHandle,
    manager: tauri::State<'_, super::client::PiManager>,
    patch: AppSettingsPatch,
) -> Result<AppSettings, String> {
    let data = crate::app_data::directory(&app)?;
    let Some(enabled) = patch.developer_mode else {
        return if patch.proxy.is_some() {
            manager.update_proxy(&data, patch).await
        } else {
            update_settings(&data, patch).await
        };
    };
    let _gate = crate::developer::SETTINGS_GATE.lock().await;
    let previous = settings(&data).await?.developer_mode;
    crate::developer::set_enabled(&data, enabled)?;
    let result = if patch.proxy.is_some() {
        manager.update_proxy(&data, patch).await
    } else {
        update_settings(&data, patch).await
    };
    if result.is_err() {
        let _ = crate::developer::set_enabled(&data, previous);
    }
    result
}

pub(super) async fn search_documents(
    data: &Path,
) -> Result<HashMap<String, IndexedDocument>, String> {
    with_database(data, |connection| {
        let mut statement = connection
            .prepare(
                "SELECT path, modified_secs, modified_nanos, size, texts FROM search_documents",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(database_error)?;
        let mut documents = HashMap::new();
        for row in rows {
            // Derived cache entries can be rebuilt from Pi's authoritative history.
            let Ok((path, seconds, nanos, size, texts)) = row else {
                continue;
            };
            let (Ok(seconds), Ok(size)) = (u64::try_from(seconds), u64::try_from(size)) else {
                continue;
            };
            if nanos >= 1_000_000_000 {
                continue;
            }
            let Some(modified) = UNIX_EPOCH.checked_add(Duration::new(seconds, nanos)) else {
                continue;
            };
            if let Ok(texts) = serde_json::from_str(&texts) {
                documents.insert(
                    path,
                    IndexedDocument {
                        modified,
                        size,
                        texts,
                    },
                );
            }
        }
        Ok(documents)
    })
    .await
}

pub(super) async fn save_search_documents(
    data: &Path,
    documents: HashMap<String, IndexedDocument>,
    existing: Vec<String>,
) -> Result<(), String> {
    with_database(data, move |connection| {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let paths = transaction.prepare("SELECT path FROM search_documents").map_err(database_error)?
            .query_map([], |row| row.get::<_, String>(0)).map_err(database_error)?
            .collect::<Result<Vec<_>, _>>().map_err(database_error)?;
        let existing: HashSet<_> = existing.into_iter().collect();
        for path in paths {
            if !existing.contains(&path) {
                transaction.execute("DELETE FROM search_documents WHERE path=?1", [path]).map_err(database_error)?;
            }
        }
        for (path, document) in documents {
            let modified = document.modified.duration_since(UNIX_EPOCH).map_err(database_error)?;
            transaction.execute(
                "INSERT INTO search_documents (path, modified_secs, modified_nanos, size, texts) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET modified_secs=excluded.modified_secs, modified_nanos=excluded.modified_nanos, size=excluded.size, texts=excluded.texts",
                params![path, i64::try_from(modified.as_secs()).map_err(database_error)?, modified.subsec_nanos(), i64::try_from(document.size).map_err(database_error)?, serde_json::to_string(&document.texts).map_err(database_error)?],
            ).map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)
    }).await
}

#[cfg(test)]
mod tests {
    use super::super::types::{AppTheme, ModelInfo};
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn fixture() -> PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/sqlite-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[tokio::test]
    async fn renamed_data_preserves_selection_pins_order_and_external_project_settings() {
        let root = fixture();
        let legacy = root.join("io.github.kannafay.pi-hearth");
        let data = root.join("Pi Hearth");
        let old_session = legacy
            .join("sessions/history.jsonl")
            .to_string_lossy()
            .into_owned();
        let new_session = data
            .join("sessions/history.jsonl")
            .to_string_lossy()
            .into_owned();
        let old_project = legacy
            .join("workspace/project")
            .to_string_lossy()
            .into_owned();
        let new_project = data
            .join("workspace/project")
            .to_string_lossy()
            .into_owned();
        let outside = root.join("external-project").to_string_lossy().into_owned();
        let prefs = Preferences {
            projects: vec![ProjectInfo {
                path: outside.clone(),
                name: "外部项目".into(),
            }],
            selection: Selection {
                project_path: None,
                session_path: Some(old_session.clone()),
            },
            session_preferences: HashMap::from([(
                super::super::catalog::session_key(&old_session),
                SessionPreference {
                    pinned: true,
                    archived: true,
                },
            )]),
        };
        save_preferences(&data, &prefs).await.unwrap();
        update_settings(
            &data,
            AppSettingsPatch {
                theme: Some(AppTheme::Dark),
                session_order: Some(vec![old_session]),
                expanded_projects: Some(HashMap::from([(
                    super::super::catalog::session_key(&old_project),
                    false,
                )])),
                pinned_projects: Some(vec![old_project]),
                projects_directory: Some(outside.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        relocate_data_paths(&data, &legacy, &data).unwrap();
        let saved = preferences(&data).await.unwrap();
        assert_eq!(
            saved.selection.session_path.as_deref(),
            Some(new_session.as_str())
        );
        assert!(saved.selection.project_path.is_none());
        assert_eq!(saved.projects[0].path, outside);
        let flags = &saved.session_preferences[&super::super::catalog::session_key(&new_session)];
        assert!(flags.pinned && flags.archived);
        let saved = settings(&data).await.unwrap();
        assert!(matches!(saved.theme, AppTheme::Dark));
        assert_eq!(saved.session_order, vec![new_session]);
        assert_eq!(saved.pinned_projects, vec![new_project.clone()]);
        assert_eq!(
            saved.expanded_projects[&super::super::catalog::session_key(&new_project)],
            false
        );
        assert_eq!(saved.projects_directory, outside);
    }

    #[tokio::test]
    async fn invalid_settings_do_not_partially_rewrite_migrated_session_preferences() {
        let root = fixture();
        let legacy = root.join("legacy");
        let data = root.join("Pi Hearth");
        let original = legacy
            .join("sessions/history.jsonl")
            .to_string_lossy()
            .into_owned();
        save_preferences(
            &data,
            &Preferences {
                selection: Selection {
                    project_path: None,
                    session_path: Some(original.clone()),
                },
                ..Default::default()
            },
        )
        .await
        .unwrap();
        open(&data)
            .unwrap()
            .execute(
                "UPDATE app_settings SET value='invalid-json' WHERE key='theme'",
                [],
            )
            .unwrap();
        assert!(relocate_data_paths(&data, &legacy, &data).is_err());
        assert_eq!(
            preferences(&data)
                .await
                .unwrap()
                .selection
                .session_path
                .as_deref(),
            Some(original.as_str())
        );
    }

    #[tokio::test]
    async fn permission_default_persists_independently_and_rejects_unknown_modes() {
        use super::super::types::PermissionMode;
        let root = fixture();
        assert_eq!(
            settings(&root).await.unwrap().default_permission,
            PermissionMode::Ask
        );
        for mode in [
            PermissionMode::Auto,
            PermissionMode::Full,
            PermissionMode::Ask,
        ] {
            update_settings(
                &root,
                AppSettingsPatch {
                    default_permission: Some(mode),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            let reopened = settings(&root).await.unwrap();
            assert_eq!(reopened.default_permission, mode);
            assert!(reopened.default_model.is_none());
        }
        assert!(
            serde_json::from_value::<AppSettingsPatch>(json!({"defaultPermission":"unknown"}))
                .is_err()
        );
    }

    #[tokio::test]
    async fn default_model_persists_after_reopening_and_invalid_writes_are_rolled_back() {
        let root = fixture();
        assert!(settings(&root).await.unwrap().default_model.is_none());
        update_settings(
            &root,
            AppSettingsPatch {
                default_model: Some(ModelInfo {
                    provider: "provider-a".into(),
                    id: "shared-id".into(),
                    name: "Saved Default".into(),
                    provider_name: None,
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let reopened = settings(&root).await.unwrap().default_model.unwrap();
        assert_eq!(reopened.provider, "provider-a");
        assert_eq!(reopened.id, "shared-id");
        assert_eq!(reopened.name, "Saved Default");
        let connection = Connection::open(root.join("app.db")).unwrap();
        let stored: String = connection
            .query_row(
                "SELECT value FROM app_settings WHERE key='defaultModel'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored).unwrap()["id"],
            "shared-id"
        );
        drop(connection);
        assert!(
            update_settings(
                &root,
                AppSettingsPatch {
                    default_model: Some(ModelInfo {
                        provider: String::new(),
                        id: "other".into(),
                        name: "Invalid".into(),
                        provider_name: None,
                    }),
                    ..Default::default()
                }
            )
            .await
            .is_err()
        );
        assert_eq!(
            settings(&root)
                .await
                .unwrap()
                .default_model
                .unwrap()
                .provider,
            "provider-a"
        );
    }

    #[tokio::test]
    async fn legacy_import_preserves_data_and_never_reimports_the_backup() {
        let root = fixture();
        let history = root.join("history.jsonl");
        std::fs::write(&history, "native Pi history\n").unwrap();
        let legacy = json!({
            "projects": [{"path":"D:\\second", "name":"第二个"}, {"path":"D:\\first", "name":"第一个"}],
            "selection": {"projectPath":"D:\\second", "sessionPath":history},
            "sessionPreferences": {"history.jsonl":{"pinned":true,"archived":true}}
        }).to_string();
        std::fs::write(root.join("workspace.json"), &legacy).unwrap();
        let mut imported = preferences(&root).await.unwrap();
        assert_eq!(imported.projects[0].name, "第二个");
        assert_eq!(imported.projects[1].name, "第一个");
        assert_eq!(imported.selection.session_path.as_deref(), history.to_str());
        assert!(imported.session_preferences["history.jsonl"].pinned);
        assert!(imported.session_preferences["history.jsonl"].archived);

        imported.projects.remove(0);
        imported.session_preferences.clear();
        imported.selection = Selection::default();
        save_preferences(&root, &imported).await.unwrap();
        let reopened = preferences(&root).await.unwrap();
        assert_eq!(reopened.projects.len(), 1);
        assert_eq!(reopened.projects[0].name, "第一个");
        assert!(reopened.session_preferences.is_empty());
        assert!(reopened.selection.session_path.is_none());
        assert_eq!(
            std::fs::read_to_string(root.join("workspace.json")).unwrap(),
            legacy
        );
        assert_eq!(
            std::fs::read_to_string(history).unwrap(),
            "native Pi history\n"
        );
        let connection = open(&root).unwrap();
        assert_eq!(
            connection
                .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))
                .unwrap(),
            "wal"
        );
        assert_eq!(
            connection
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
    }

    #[tokio::test]
    async fn invalid_legacy_data_aborts_migration_and_can_be_repaired() {
        let root = fixture();
        std::fs::write(root.join("workspace.json"), "{broken").unwrap();
        assert!(
            preferences(&root)
                .await
                .unwrap_err()
                .contains("workspace.json")
        );
        let connection = Connection::open(root.join("app.db")).unwrap();
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        drop(connection);
        assert_eq!(
            std::fs::read_to_string(root.join("workspace.json")).unwrap(),
            "{broken"
        );
        std::fs::write(root.join("workspace.json"), "{}").unwrap();
        assert!(preferences(&root).await.unwrap().projects.is_empty());
    }

    #[tokio::test]
    async fn concurrent_setting_patches_preserve_other_preferences_and_rollback_invalid_values() {
        let root = fixture();
        settings(&root).await.unwrap();
        let (theme, width) = tokio::join!(
            update_settings(
                &root,
                AppSettingsPatch {
                    theme: Some(AppTheme::Dark),
                    developer_mode: Some(true),
                    ..Default::default()
                }
            ),
            update_settings(
                &root,
                AppSettingsPatch {
                    navigation_width: Some(312.0),
                    thinking_level: Some("xhigh".into()),
                    ..Default::default()
                }
            )
        );
        theme.unwrap();
        width.unwrap();
        // A metadata save must not reset independently stored UI settings.
        save_preferences(&root, &Preferences::default())
            .await
            .unwrap();
        let saved = settings(&root).await.unwrap();
        assert!(matches!(saved.theme, AppTheme::Dark));
        assert!(saved.developer_mode);
        assert_eq!(saved.navigation_width, 312.0);
        assert_eq!(saved.thinking_level.as_deref(), Some("xhigh"));

        assert!(
            update_settings(
                &root,
                AppSettingsPatch {
                    theme: Some(AppTheme::Light),
                    navigation_width: Some(0.0),
                    ..Default::default()
                }
            )
            .await
            .is_err()
        );
        assert!(
            update_settings(
                &root,
                AppSettingsPatch {
                    thinking_level: Some("invalid".into()),
                    ..Default::default()
                }
            )
            .await
            .is_err()
        );
        let reopened = settings(&root).await.unwrap();
        assert!(matches!(reopened.theme, AppTheme::Dark));
        assert!(reopened.developer_mode);
        assert_eq!(reopened.navigation_width, 312.0);
        assert_eq!(reopened.thinking_level.as_deref(), Some("xhigh"));
    }

    #[tokio::test]
    async fn off_thinking_preference_survives_reopening_and_can_return_to_default() {
        let root = fixture();
        update_settings(
            &root,
            AppSettingsPatch {
                thinking_level: Some("off".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        save_preferences(&root, &Preferences::default())
            .await
            .unwrap();
        assert_eq!(
            settings(&root).await.unwrap().thinking_level.as_deref(),
            Some("off")
        );
        update_settings(
            &root,
            AppSettingsPatch {
                thinking_level: Some("default".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            settings(&root).await.unwrap().thinking_level.as_deref(),
            Some("default")
        );
    }

    #[tokio::test]
    async fn navigation_order_and_project_flags_survive_catalog_saves() {
        let root = fixture();
        let defaults = settings(&root).await.unwrap();
        assert!(defaults.project_order.is_empty());
        assert!(defaults.session_order.is_empty());
        assert!(defaults.pinned_projects.is_empty());
        assert!(defaults.archived_projects.is_empty());
        update_settings(
            &root,
            AppSettingsPatch {
                project_order: Some(vec!["project-b".into(), "project-a".into()]),
                session_order: Some(vec!["chat-b".into(), "chat-a".into()]),
                pinned_projects: Some(vec!["project-b".into()]),
                archived_projects: Some(vec!["archived-project".into()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        save_preferences(&root, &Preferences::default())
            .await
            .unwrap();
        let saved = settings(&root).await.unwrap();
        assert_eq!(saved.project_order, ["project-b", "project-a"]);
        assert_eq!(saved.session_order, ["chat-b", "chat-a"]);
        assert_eq!(saved.pinned_projects, ["project-b"]);
        assert_eq!(saved.archived_projects, ["archived-project"]);
        update_settings(
            &root,
            AppSettingsPatch {
                archived_projects: Some(Vec::new()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let restored = settings(&root).await.unwrap();
        assert!(restored.archived_projects.is_empty());
        assert_eq!(restored.project_order, saved.project_order);
        assert_eq!(restored.pinned_projects, saved.pinned_projects);
    }

    #[tokio::test]
    async fn project_save_locations_persist_and_can_return_to_the_default() {
        let root = fixture();
        assert!(settings(&root).await.unwrap().projects_directory.is_empty());
        let directory = root.join("projects").to_string_lossy().into_owned();
        update_settings(
            &root,
            AppSettingsPatch {
                projects_directory: Some(directory.clone()),
                custom_projects_directory: Some(directory.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(settings(&root).await.unwrap().projects_directory, directory);
        assert_eq!(
            settings(&root).await.unwrap().custom_projects_directory,
            directory
        );
        assert!(
            update_settings(
                &root,
                AppSettingsPatch {
                    projects_directory: Some("../relative".into()),
                    ..Default::default()
                }
            )
            .await
            .is_err()
        );
        assert_eq!(settings(&root).await.unwrap().projects_directory, directory);
        assert!(
            update_settings(
                &root,
                AppSettingsPatch {
                    custom_projects_directory: Some("../relative".into()),
                    ..Default::default()
                }
            )
            .await
            .is_err()
        );
        update_settings(
            &root,
            AppSettingsPatch {
                projects_directory: Some(String::new()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let reopened = settings(&root).await.unwrap();
        assert!(reopened.projects_directory.is_empty());
        assert_eq!(reopened.custom_projects_directory, directory);
        update_settings(
            &root,
            AppSettingsPatch {
                projects_directory: Some(reopened.custom_projects_directory),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(settings(&root).await.unwrap().projects_directory, directory);
    }

    #[tokio::test]
    async fn first_startup_requests_share_one_migration() {
        let root = fixture();
        let (first, second, third) =
            tokio::join!(settings(&root), preferences(&root), settings(&root));
        assert!(first.unwrap().sidebar_open);
        assert!(second.unwrap().projects.is_empty());
        let defaults = third.unwrap();
        assert_eq!(defaults.navigation_width, 300.0);
        assert_eq!(defaults.inspector_width, 300.0);
    }

    #[tokio::test]
    async fn file_locations_persist_independently_and_reject_relative_paths() {
        let root = fixture();
        let files = root.join("Files").to_string_lossy().into_owned();
        let projects = root.join("Projects").to_string_lossy().into_owned();
        let saved = update_settings(
            &root,
            AppSettingsPatch {
                projects_directory: Some(projects.clone()),
                files_directory: Some(files.clone()),
                custom_files_directory: Some(files.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.files_directory, files);
        update_settings(
            &root,
            AppSettingsPatch {
                files_directory: Some(String::new()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let restored = settings(&root).await.unwrap();
        assert!(restored.files_directory.is_empty());
        assert_eq!(restored.custom_files_directory, files);
        assert_eq!(restored.projects_directory, projects);
        for patch in [
            AppSettingsPatch {
                files_directory: Some("../relative".into()),
                ..Default::default()
            },
            AppSettingsPatch {
                custom_files_directory: Some("relative".into()),
                ..Default::default()
            },
        ] {
            assert!(update_settings(&root, patch).await.is_err());
        }
        assert_eq!(settings(&root).await.unwrap().custom_files_directory, files);
    }

    #[tokio::test]
    async fn newer_schema_is_rejected_without_resetting_the_database() {
        let root = fixture();
        let connection = Connection::open(root.join("app.db")).unwrap();
        connection.execute_batch("PRAGMA user_version=99; CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep');").unwrap();
        drop(connection);
        assert!(settings(&root).await.unwrap_err().contains("更新"));
        let connection = Connection::open(root.join("app.db")).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT value FROM future_data", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "keep"
        );
    }

    #[tokio::test]
    async fn search_cache_reopens_with_exact_file_signature_and_removes_deleted_content() {
        let root = fixture();
        let modified = UNIX_EPOCH + Duration::new(1_790_000_000, 123_456_789);
        let document = IndexedDocument {
            modified,
            size: 456,
            texts: vec!["中文搜索 HEARTH-UI-42".into()],
        };
        save_search_documents(
            &root,
            HashMap::from([
                ("one.jsonl".into(), document.clone()),
                ("two.jsonl".into(), document),
            ]),
            vec!["one.jsonl".into(), "two.jsonl".into()],
        )
        .await
        .unwrap();
        let cache = search_documents(&root).await.unwrap();
        assert_eq!(cache["one.jsonl"].modified, modified);
        assert_eq!(cache["one.jsonl"].size, 456);
        assert_eq!(cache["one.jsonl"].texts, ["中文搜索 HEARTH-UI-42"]);
        save_search_documents(&root, HashMap::new(), vec!["one.jsonl".into()])
            .await
            .unwrap();
        assert_eq!(search_documents(&root).await.unwrap().len(), 1);
        save_preferences_and_remove_documents(
            &root,
            &Preferences::default(),
            vec!["one.jsonl".into()],
        )
        .await
        .unwrap();
        assert!(search_documents(&root).await.unwrap().is_empty());
    }
}
