use super::{
    catalog::{same_path, session_key},
    types::*,
};
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

#[derive(Clone)]
pub struct IndexedDocument {
    pub modified: SystemTime,
    pub size: u64,
    pub texts: Vec<String>,
}

#[derive(Default)]
pub struct SearchIndex {
    pub catalog: Option<(Instant, WorkspaceCatalog)>,
    pub documents: HashMap<String, IndexedDocument>,
    pub persisted_loaded: bool,
}

fn excerpt(text: &str, offset: usize) -> String {
    let start = offset.saturating_sub(38);
    let mut chars = text.chars().skip(start);
    let body: String = chars.by_ref().take(150).collect();
    let has_tail = chars.next().is_some();
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body.split_whitespace().collect::<Vec<_>>().join(" "),
        if has_tail { "…" } else { "" }
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
            if catalog
                .session_preferences
                .get(&session_key(&session.path))
                .is_some_and(|entry| entry.archived)
            {
                continue;
            }
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
            // Every word must match, but words may match different fields/messages.
            let mut matched: Vec<_> = terms
                .iter()
                .map(|term| title.contains(term.as_str()) || project.contains(term.as_str()))
                .collect();
            let mut remaining = matched.iter().filter(|matched| !**matched).count();
            let mut body = None;
            // An empty query only needs recent session metadata. For content queries,
            // normalize one message at a time and stop once every term and the first
            // snippet have been found, instead of cloning all the conversation text.
            if !terms.is_empty() {
                for text in texts {
                    let lower = text.to_lowercase();
                    let mut first_offset: Option<usize> = None;
                    for (matched, term) in matched.iter_mut().zip(&terms) {
                        if *matched && body.is_some() {
                            continue;
                        }
                        if let Some(offset) = lower.find(term) {
                            first_offset = Some(first_offset.map_or(offset, |old| old.min(offset)));
                            if !*matched {
                                *matched = true;
                                remaining -= 1;
                            }
                        }
                    }
                    if body.is_none()
                        && let Some(offset) = first_offset
                    {
                        body = Some((text, lower[..offset].chars().count()));
                    }
                    if remaining == 0 && body.is_some() {
                        break;
                    }
                }
            }
            if remaining != 0 {
                continue;
            }
            let title_match = terms.iter().any(|term| title.contains(term));
            let project_match = terms.iter().any(|term| project.contains(term));
            let snippet = body
                .map(|(text, offset)| excerpt(text, offset))
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

    fn large_index() -> SearchIndex {
        let mut index = SearchIndex::default();
        let mut sessions = Vec::new();
        for id in 0..160 {
            let path = id.to_string();
            sessions.push(SessionInfo {
                path: path.clone(),
                id: path.clone(),
                cwd: "project".into(),
                title: format!("Session {id}"),
                modified: id,
                message_count: 80,
            });
            let mut texts = vec!["needle in the first message".into()];
            texts.extend((0..79).map(|_| "普通历史聊天内容 previous conversation ".repeat(30)));
            index.documents.insert(
                path,
                IndexedDocument {
                    modified: SystemTime::UNIX_EPOCH,
                    size: 1,
                    texts,
                },
            );
        }
        index.catalog = Some((
            Instant::now(),
            WorkspaceCatalog {
                sessions,
                projects: vec![],
                general_cwd: "project".into(),
                selection: Selection::default(),
                session_preferences: HashMap::new(),
            },
        ));
        index
    }

    #[test]
    fn recent_results_are_bounded_sorted_and_do_not_use_body_snippets() {
        let index = large_index();
        let recent = index.query(" \t ");
        assert_eq!(recent.len(), 40);
        assert_eq!(recent.first().unwrap().session.id, "159");
        assert_eq!(recent.last().unwrap().session.id, "120");
        assert!(
            recent
                .iter()
                .all(|result| result.snippet == "聊天" && result.matched_in == "recent")
        );
    }

    #[test]
    fn keywords_can_match_separate_messages_and_keep_the_first_snippet() {
        let mut index = large_index();
        index.documents.get_mut("0").unwrap().texts = vec![
            "First ALPHA message".into(),
            "unrelated message".into(),
            "Later BETA message".into(),
        ];
        let results = index.query("alpha beta");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session.id, "0");
        assert_eq!(results[0].snippet, "First ALPHA message");
        assert_eq!(results[0].matched_in, "content");
        assert_eq!(index.query("session beta")[0].matched_in, "title");
        assert!(index.query("alpha absent").is_empty());
    }

    #[test]
    fn excerpts_bound_large_unicode_messages_without_truncating_the_match() {
        let text = format!("{}关键字{}", "前".repeat(10_000), "后".repeat(10_000));
        let snippet = excerpt(&text, 10_000);
        assert!(snippet.starts_with('…') && snippet.ends_with('…'));
        assert!(snippet.contains("关键字"));
        assert_eq!(snippet.chars().count(), 152);
    }

    #[test]
    #[ignore = "manual search performance comparison"]
    fn benchmark_search_queries() {
        let index = large_index();
        for query in ["", "needle", "missing"] {
            let started = Instant::now();
            for _ in 0..20 {
                std::hint::black_box(index.query(query));
            }
            eprintln!(
                "query={query:?} mean_ms={:.3}",
                started.elapsed().as_secs_f64() * 1000.0 / 20.0
            );
        }
    }

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
                    session_preferences: HashMap::new(),
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
        index
            .catalog
            .as_mut()
            .unwrap()
            .1
            .session_preferences
            .insert(
                "0".into(),
                SessionPreference {
                    pinned: false,
                    archived: true,
                },
            );
        assert_eq!(index.query("关键词").len(), 1);
        assert!(
            index
                .query("")
                .iter()
                .all(|result| result.session.path != "0")
        );
    }
}
