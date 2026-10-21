use super::{catalog::same_path, types::*};
use serde::Deserialize;
use std::{
    collections::HashMap,
    time::{Instant, SystemTime},
};

#[derive(Deserialize)]
pub struct SearchDocument {
    pub path: String,
    pub texts: Vec<String>,
}

pub struct IndexedDocument {
    pub modified: SystemTime,
    pub size: u64,
    pub texts: Vec<String>,
}

#[derive(Default)]
pub struct SearchIndex {
    pub catalog: Option<(Instant, WorkspaceCatalog)>,
    pub documents: HashMap<String, IndexedDocument>,
}

fn excerpt(text: &str, terms: &[String]) -> String {
    let lower = text.to_lowercase();
    let offset = terms
        .iter()
        .filter_map(|term| lower.find(term))
        .min()
        .unwrap_or(0);
    let start = lower[..offset].chars().count().saturating_sub(38);
    let chars: Vec<_> = text.chars().collect();
    let end = (start + 150).min(chars.len());
    let body: String = chars[start.min(end)..end].iter().collect();
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body.split_whitespace().collect::<Vec<_>>().join(" "),
        if end < chars.len() { "…" } else { "" }
    )
}

impl SearchIndex {
    pub fn query(&self, query: &str) -> Vec<SessionSearchResult> {
        let Some((_, catalog)) = &self.catalog else {
            return Vec::new();
        };
        let terms: Vec<_> = query
            .split_whitespace()
            .take(12)
            .map(str::to_lowercase)
            .collect();
        let mut results = Vec::new();
        for session in &catalog.sessions {
            let project_name = catalog
                .projects
                .iter()
                .find(|project| same_path(&project.path, &session.cwd))
                .map(|project| project.name.clone())
                .unwrap_or_else(|| {
                    if same_path(&session.cwd, &catalog.general_cwd) {
                        "聊天".into()
                    } else {
                        std::path::Path::new(&session.cwd)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into()
                    }
                });
            let title = session.title.to_lowercase();
            let project = project_name.to_lowercase();
            let texts = self
                .documents
                .get(&session.path)
                .map(|doc| doc.texts.as_slice())
                .unwrap_or_default();
            let content = texts
                .iter()
                .map(|text| text.to_lowercase())
                .collect::<Vec<_>>();
            // Every word must match, but words may match different fields/messages.
            if !terms.iter().all(|term| {
                title.contains(term)
                    || project.contains(term)
                    || content.iter().any(|text| text.contains(term))
            }) {
                continue;
            }
            let title_match = !terms.is_empty() && terms.iter().any(|term| title.contains(term));
            let project_match =
                !terms.is_empty() && terms.iter().any(|term| project.contains(term));
            let body = texts
                .iter()
                .zip(&content)
                .find(|(_, lower)| terms.iter().any(|term| lower.contains(term)));
            let snippet = body
                .map(|(text, _)| excerpt(text, &terms))
                .unwrap_or_else(|| project_name.clone());
            let matched_in = if terms.is_empty() {
                "recent"
            } else if title_match {
                "title"
            } else if project_match {
                "project"
            } else {
                "content"
            };
            let score =
                u8::from(title_match) * 4 + u8::from(project_match) * 2 + u8::from(body.is_some());
            results.push((
                score,
                SessionSearchResult {
                    session: session.clone(),
                    project_name,
                    snippet,
                    matched_in: matched_in.into(),
                },
            ));
        }
        results.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| b.1.session.modified.cmp(&a.1.session.modified))
        });
        results
            .into_iter()
            .take(40)
            .map(|(_, result)| result)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn searches_all_fields_ranks_titles_and_keeps_unicode_snippets() {
        let sessions = ["标题关键词", "历史聊天", "另一个"]
            .into_iter()
            .enumerate()
            .map(|(i, title)| SessionInfo {
                path: i.to_string(),
                id: i.to_string(),
                cwd: "project".into(),
                title: title.into(),
                modified: i as u64,
                message_count: 2,
            })
            .collect();
        let mut index = SearchIndex {
            catalog: Some((
                Instant::now(),
                WorkspaceCatalog {
                    sessions,
                    projects: vec![ProjectInfo {
                        path: "project".into(),
                        name: "项目 Hearth".into(),
                    }],
                    general_cwd: "general".into(),
                    selection: Selection::default(),
                },
            )),
            ..Default::default()
        };
        index.documents.insert(
            "1".into(),
            IndexedDocument {
                modified: SystemTime::now(),
                size: 1,
                texts: vec![format!("{}中文关键词与 RUST 的测试", "前文".repeat(50))],
            },
        );
        let results = index.query("关键词");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].matched_in, "title");
        assert!(results[1].snippet.contains("中文关键词"));
        assert_eq!(index.query("hearth rust").len(), 1);
        assert!(index.query("不存在").is_empty());
        assert_eq!(index.query("")[0].session.path, "2");
    }
}
