use std::collections::BTreeMap;
use tauri::{
    ipc::{Origin, RuntimeAuthority},
    utils::{
        acl::{capability::Capability, manifest::Manifest, resolved::Resolved},
        platform::Target,
    },
};

fn authority(target: Target) -> RuntimeAuthority {
    // Exercise Tauri's actual resolver against the manifest produced by build.rs.
    let manifests: BTreeMap<String, Manifest> = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/acl-manifests.json"
    )))
    .unwrap();
    let capabilities: BTreeMap<String, Capability> = [
        serde_json::from_str::<Capability>(include_str!("../capabilities/default.json")).unwrap(),
        serde_json::from_str::<Capability>(include_str!("../capabilities/tray.json")).unwrap(),
    ]
    .into_iter()
    .map(|capability| (capability.identifier.clone(), capability))
    .collect();
    let resolved = Resolved::resolve(&manifests, capabilities, target).unwrap();
    assert!(
        resolved.has_app_acl,
        "custom commands must not bypass the ACL"
    );
    tauri::runtime_authority!(manifests, resolved)
}

#[test]
fn privileged_commands_are_only_accessible_to_the_local_main_window() {
    for target in [Target::Windows, Target::MacOS, Target::Linux] {
        let authority = authority(target);
        for command in [
            "pi_send",
            "pi_set_permission",
            "attachment_preview",
            "app_update_settings",
            "workspace_change_projects_directory",
            "developer_console_open",
        ] {
            assert!(
                authority
                    .resolve_access(command, "main", "main", &Origin::Local)
                    .is_some(),
                "{command}"
            );
            for window in ["tray-menu", "untrusted"] {
                assert!(
                    authority
                        .resolve_access(command, window, window, &Origin::Local)
                        .is_none(),
                    "{window}: {command}"
                );
            }
            let remote = Origin::Remote {
                url: "https://example.com/".parse().unwrap(),
            };
            assert!(
                authority
                    .resolve_access(command, "main", "main", &remote)
                    .is_none(),
                "remote: {command}"
            );
        }
        assert!(
            authority
                .resolve_access("unknown_command", "main", "main", &Origin::Local)
                .is_none()
        );
    }
}

#[test]
fn tray_acknowledgements_cannot_be_called_from_the_main_window() {
    let authority = authority(Target::MacOS);
    for command in [
        "tray_ready",
        "tray_present",
        "tray_dismiss",
        "tray_closed",
        "tray_action",
    ] {
        assert!(
            authority
                .resolve_access(command, "tray-menu", "tray-menu", &Origin::Local)
                .is_some(),
            "{command}"
        );
        assert!(
            authority
                .resolve_access(command, "main", "main", &Origin::Local)
                .is_none(),
            "{command}"
        );
    }
}
