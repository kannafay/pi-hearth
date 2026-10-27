use super::super::catalog::session_key;
use super::*;
use serde_json::json;

struct Fixture {
    root: PathBuf,
    data: PathBuf,
    default: PathBuf,
    target: PathBuf,
    catalog: WorkspaceCatalog,
}

impl Fixture {
    async fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../work/project-location-test")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let root = dunce::canonicalize(root).unwrap();
        let data = root.join("data");
        let default = root.join("原项目");
        let target = root.join("新项目");
        let first = default.join("项目一");
        let second = default.join("项目二");
        let nested = first.join("子项目");
        let external = root.join("external");
        for directory in [
            data.join("sessions"),
            first.join("src"),
            first.join(".pi/history"),
            second.join(".git/objects"),
            nested.clone(),
            external.clone(),
        ] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(first.join("src/keep.txt"), "项目文件").unwrap();
        fs::write(second.join(".git/objects/keep"), "Git 对象").unwrap();
        fs::write(external.join("keep.txt"), "外部文件").unwrap();
        fs::write(default.join("unrelated.txt"), "保留原目录中的其他文件").unwrap();
        let local = first.join(".pi").join("history").join("local.jsonl");
        let global = data.join("sessions").join("global.jsonl");
        for (file, cwd, parent) in [(&local, &nested, &global), (&global, &first, &local)] {
            fs::write(file, format!("{}\r\n{}\r\n", json!({"type":"session", "version":3, "id":uuid::Uuid::new_v4().to_string(), "cwd":cwd, "parentSession":parent}), json!({"type":"message", "content":format!("原始正文引用 {}", first.display())}))).unwrap();
        }
        fs::write(
            first.join(".pi/settings.json"),
            serde_json::to_vec(
                &json!({"sessionDir": first.join(".pi").join("history"), "other":42}),
            )
            .unwrap(),
        )
        .unwrap();
        let projects = vec![
            ProjectInfo {
                path: first.to_string_lossy().into_owned(),
                name: "自定义名称".into(),
            },
            ProjectInfo {
                path: second.to_string_lossy().into_owned(),
                name: "归档项目".into(),
            },
            ProjectInfo {
                path: nested.to_string_lossy().into_owned(),
                name: "子项目".into(),
            },
            ProjectInfo {
                path: external.to_string_lossy().into_owned(),
                name: "外部项目".into(),
            },
        ];
        let preferences = storage::Preferences {
            projects: projects.clone(),
            selection: Selection {
                project_path: Some(first.to_string_lossy().into_owned()),
                session_path: Some(local.to_string_lossy().into_owned()),
            },
            session_preferences: std::collections::HashMap::from([(
                session_key(&local.to_string_lossy()),
                SessionPreference {
                    pinned: true,
                    archived: true,
                },
            )]),
        };
        storage::save_preferences(&data, &preferences)
            .await
            .unwrap();
        storage::update_settings(
            &data,
            AppSettingsPatch {
                expanded_projects: Some(std::collections::HashMap::from([(
                    session_key(&first.to_string_lossy()),
                    false,
                )])),
                project_order: Some(
                    projects
                        .iter()
                        .map(|project| project.path.clone())
                        .collect(),
                ),
                pinned_projects: Some(vec![first.to_string_lossy().into_owned()]),
                archived_projects: Some(vec![second.to_string_lossy().into_owned()]),
                session_order: Some(vec![
                    local.to_string_lossy().into_owned(),
                    global.to_string_lossy().into_owned(),
                ]),
                files_directory: Some(external.to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let catalog = WorkspaceCatalog {
            projects,
            sessions: vec![
                SessionInfo {
                    path: local.to_string_lossy().into_owned(),
                    cwd: nested.to_string_lossy().into_owned(),
                    id: "local".into(),
                    title: "本地历史".into(),
                    modified: 123,
                    message_count: 1,
                },
                SessionInfo {
                    path: global.to_string_lossy().into_owned(),
                    cwd: first.to_string_lossy().into_owned(),
                    id: "global".into(),
                    title: "共享历史".into(),
                    modified: 456,
                    message_count: 1,
                },
            ],
            general_cwd: data.join("workspace").to_string_lossy().into_owned(),
            selection: preferences.selection,
            session_preferences: preferences.session_preferences,
        };
        Self {
            root,
            data,
            default,
            target,
            catalog,
        }
    }

    async fn prepare(&self, directory: &Path) -> Migration {
        Migration::prepare(
            self.data.clone(),
            self.default.clone(),
            directory.to_string_lossy().into_owned(),
            storage::settings(&self.data).await.unwrap(),
            self.catalog.clone(),
        )
        .unwrap()
    }
}

#[tokio::test]
async fn moving_and_returning_to_default_preserves_projects_history_and_preferences() {
    let fixture = Fixture::new().await;
    let original_history = fs::read(&fixture.catalog.sessions[1].path).unwrap();
    let original_modified = fs::metadata(&fixture.catalog.sessions[1].path)
        .unwrap()
        .modified()
        .unwrap();
    let result = fixture.prepare(&fixture.target).await.run().unwrap();
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert_eq!(result.paths.len(), 2); // The nested project moves with its parent.
    assert_eq!(result.catalog.projects[0].name, "自定义名称");
    assert_eq!(
        fs::read_to_string(fixture.target.join("项目一/src/keep.txt")).unwrap(),
        "项目文件"
    );
    assert!(fixture.target.join("项目二/.git/objects/keep").is_file());
    assert!(!fixture.default.join("项目一").exists());
    assert!(fixture.default.join("unrelated.txt").is_file());
    assert!(fixture.root.join("external/keep.txt").is_file());
    let local = dunce::canonicalize(fixture.target.join("项目一/.pi/history/local.jsonl")).unwrap();
    assert_eq!(result.catalog.sessions[0].path, local.to_string_lossy());
    let global = fs::read(&fixture.catalog.sessions[1].path).unwrap();
    assert_eq!(
        &global[global.iter().position(|b| *b == b'\n').unwrap()..],
        &original_history[original_history.iter().position(|b| *b == b'\n').unwrap()..]
    );
    let header: serde_json::Value =
        serde_json::from_slice(global.split(|b| *b == b'\n').next().unwrap()).unwrap();
    assert_eq!(
        header["cwd"],
        fixture.target.join("项目一").to_string_lossy().as_ref()
    );
    assert_eq!(header["parentSession"], local.to_string_lossy().as_ref());
    assert_eq!(
        fs::metadata(&fixture.catalog.sessions[1].path)
            .unwrap()
            .modified()
            .unwrap(),
        original_modified
    );
    let settings = storage::settings(&fixture.data).await.unwrap();
    assert_eq!(
        settings.projects_directory,
        fixture.target.to_string_lossy()
    );
    assert_eq!(
        settings.files_directory,
        fixture.root.join("external").to_string_lossy()
    );
    assert_eq!(
        settings.pinned_projects,
        vec![fixture.target.join("项目一").to_string_lossy()]
    );
    assert_eq!(
        settings.archived_projects,
        vec![fixture.target.join("项目二").to_string_lossy()]
    );
    assert_eq!(
        settings.expanded_projects.get(&session_key(
            &fixture.target.join("项目一").to_string_lossy()
        )),
        Some(&false)
    );
    assert_eq!(settings.session_order[0], local.to_string_lossy());
    assert!(result.catalog.session_preferences[&session_key(&local.to_string_lossy())].pinned);
    assert!(result.catalog.session_preferences[&session_key(&local.to_string_lossy())].archived);
    let local_settings: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.target.join("项目一/.pi/settings.json")).unwrap())
            .unwrap();
    assert_eq!(
        local_settings["sessionDir"],
        dunce::canonicalize(fixture.target.join("项目一/.pi/history"))
            .unwrap()
            .to_string_lossy()
            .as_ref()
    );
    let returned = Migration::prepare(
        fixture.data.clone(),
        fixture.default.clone(),
        String::new(),
        settings,
        result.catalog,
    )
    .unwrap()
    .run()
    .unwrap();
    assert!(returned.settings.projects_directory.is_empty());
    assert_eq!(
        returned.settings.custom_projects_directory,
        fixture.target.to_string_lossy()
    );
    assert!(fixture.default.join("项目一/src/keep.txt").is_file());
    assert!(!fixture.target.join("项目一").exists());
    assert_eq!(
        fs::read(&fixture.catalog.sessions[1].path).unwrap(),
        original_history
    );
}

#[tokio::test]
async fn a_destination_collision_aborts_before_moving_any_project() {
    let fixture = Fixture::new().await;
    fs::create_dir_all(fixture.target.join("项目二")).unwrap();
    fs::write(fixture.target.join("项目二/keep.txt"), "已有项目").unwrap();
    let result = Migration::prepare(
        fixture.data.clone(),
        fixture.default.clone(),
        fixture.target.to_string_lossy().into_owned(),
        storage::settings(&fixture.data).await.unwrap(),
        fixture.catalog.clone(),
    );
    assert!(result.err().unwrap().contains("目标目录已存在"));
    assert!(fixture.default.join("项目一/src/keep.txt").is_file());
    assert!(!fixture.target.join("项目一").exists());
    assert_eq!(
        fs::read_to_string(fixture.target.join("项目二/keep.txt")).unwrap(),
        "已有项目"
    );
    assert!(
        storage::settings(&fixture.data)
            .await
            .unwrap()
            .projects_directory
            .is_empty()
    );
}

#[tokio::test]
async fn late_move_failures_restore_previously_moved_directories() {
    let fixture = Fixture::new().await;
    let migration = fixture.prepare(&fixture.target).await;
    fs::create_dir_all(fixture.target.join("项目二")).unwrap();
    assert!(migration.run().unwrap_err().contains("已恢复原目录"));
    assert!(fixture.default.join("项目一/src/keep.txt").is_file());
    assert!(!fixture.target.join("项目一").exists());
    assert!(fixture.target.join("项目二").is_dir());
}

#[tokio::test]
async fn database_failure_restores_history_bytes_directories_and_all_saved_paths() {
    let fixture = Fixture::new().await;
    let originals: Vec<_> = fixture
        .catalog
        .sessions
        .iter()
        .map(|session| fs::read(&session.path).unwrap())
        .collect();
    let connection = rusqlite::Connection::open(fixture.data.join("app.db")).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_location BEFORE UPDATE ON app_settings WHEN NEW.key='projectsDirectory' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;").unwrap();
    let error = fixture.prepare(&fixture.target).await.run().unwrap_err();
    assert!(error.contains("injected write failure"), "{error}");
    for (session, bytes) in fixture.catalog.sessions.iter().zip(originals) {
        assert_eq!(fs::read(&session.path).unwrap(), bytes);
    }
    assert!(fixture.default.join("项目一/src/keep.txt").is_file());
    assert!(!fixture.target.join("项目一").exists());
    assert!(!fixture.target.join("项目二").exists());
    let settings = storage::settings(&fixture.data).await.unwrap();
    assert!(settings.projects_directory.is_empty());
    assert_eq!(
        settings.pinned_projects[0],
        fixture.catalog.projects[0].path
    );
    assert_eq!(
        storage::preferences(&fixture.data).await.unwrap().projects[0].path,
        fixture.catalog.projects[0].path
    );
}

#[tokio::test]
async fn nested_save_roots_are_rejected_and_reselecting_the_same_root_is_harmless() {
    let fixture = Fixture::new().await;
    let nested = fixture.default.join("nested");
    let error = Migration::prepare(
        fixture.data.clone(),
        fixture.default.clone(),
        nested.to_string_lossy().into_owned(),
        storage::settings(&fixture.data).await.unwrap(),
        fixture.catalog.clone(),
    )
    .err()
    .unwrap();
    assert!(error.contains("互相包含"));
    let result = fixture.prepare(&fixture.default).await.run().unwrap();
    assert!(result.paths.is_empty());
    assert!(fixture.default.join("项目一/src/keep.txt").is_file());
}

#[tokio::test]
async fn moving_projects_repairs_internal_directory_links_and_preserves_external_links() {
    let fixture = Fixture::new().await;
    let project = fixture.default.join("项目一");
    crate::app_data::directory_alias(&project.join("src"), &project.join("internal-link")).unwrap();
    crate::app_data::directory_alias(
        &fixture.root.join("external"),
        &project.join("external-link"),
    )
    .unwrap();
    fixture.prepare(&fixture.target).await.run().unwrap();
    assert_eq!(
        fs::read_to_string(fixture.target.join("项目一/internal-link/keep.txt")).unwrap(),
        "项目文件"
    );
    assert_eq!(
        fs::read_to_string(fixture.target.join("项目一/external-link/keep.txt")).unwrap(),
        "外部文件"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn cross_volume_moves_preserve_read_only_git_objects_and_directory_junctions() {
    let fixture = Fixture::new().await;
    let target = std::env::temp_dir().join(format!(
        "pi-hearth-project-migration-{}",
        uuid::Uuid::new_v4()
    ));
    if fixture.default.components().next() == target.components().next() {
        eprintln!("Cross-volume fixture requires a temporary directory on another volume.");
        return;
    }
    let object = fixture.default.join("项目二/.git/objects/keep");
    let mut permissions = fs::metadata(&object).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&object, permissions).unwrap();
    crate::app_data::directory_alias(
        &fixture.default.join("项目一/src"),
        &fixture.default.join("项目一/internal-link"),
    )
    .unwrap();
    let result = fixture.prepare(&target).await.run().unwrap();
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert!(!fixture.default.join("项目一").exists());
    assert!(!fixture.default.join("项目二").exists());
    assert!(
        fs::metadata(target.join("项目二/.git/objects/keep"))
            .unwrap()
            .permissions()
            .readonly()
    );
    assert_eq!(
        fs::read_to_string(target.join("项目一/internal-link/keep.txt")).unwrap(),
        "项目文件"
    );
    assert!(target.starts_with(std::env::temp_dir()));
    remove_directory(&target).unwrap();
}
