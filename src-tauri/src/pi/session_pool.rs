use super::client::PiClient;
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime},
};
use tokio::time::Instant;

pub(super) const MAX_OPEN_SESSIONS: usize = 3;
pub(super) const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FileRevision {
    pub path: String,
    size: u64,
    modified: SystemTime,
}

impl FileRevision {
    pub fn read(file: &str) -> Option<Self> {
        let path = dunce::canonicalize(file).ok()?;
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() {
            return None;
        }
        Some(Self {
            path: super::catalog::session_key(&path.to_string_lossy()),
            size: metadata.len(),
            modified: metadata.modified().ok()?,
        })
    }
}

pub(super) struct RetainedSession {
    pub client: Arc<PiClient>,
    pub file: Option<FileRevision>,
    // A running turn keeps its action scope and renderer subscription intact.
    pub live: bool,
    pub since: Instant,
    pub owned: bool,
}

impl RetainedSession {
    pub fn expired(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.since) >= IDLE_TIMEOUT
            || self
                .file
                .as_ref()
                .is_some_and(|file| !Path::new(&file.path).is_file())
            || !Path::new(&self.client.project_path).is_dir()
    }
}

impl Drop for RetainedSession {
    fn drop(&mut self) {
        // Pool eviction or cancellation must not leave an unowned child alive.
        if self.owned {
            self.client.abort_runtime();
        }
    }
}
