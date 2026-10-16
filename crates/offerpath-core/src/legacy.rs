//! Importing an old Job Hunter installation's data on this computer
//! (docs/plan.md, section 9, step 4).
//!
//! Job Hunter kept everything in `%APPDATA%\JobHunter` (macOS:
//! `~/Library/Application Support/JobHunter`, Linux: `~/.local/share/job-hunter`).
//! On first start Offerpath offers to copy it: the local store (including
//! local-only collections such as job-site profiles, the publishing plan,
//! scan cursors and the queue), generated resumes and cover letters, exports,
//! and settings (sources, Claude and Chrome setup).
//!
//! Left behind on purpose: run transcripts and logs (debugging artifacts,
//! hundreds of MB), and the old server sign-ins: every device signs in to
//! Offerpath fresh. Job Hunter's folder is only read, never changed.
//!
//! Stored documents carry absolute file paths (a generated resume's PDF, for
//! one); those are rewritten from the old folder to the new one.

use std::path::{Path, PathBuf};

use directories::BaseDirs;
use serde::Serialize;

use crate::error::{CoreError, CoreResult};
use crate::paths::AppPaths;

/// Folders copied as they are, under the data root.
const COPIED_DIRS: &[&str] = &["database", "resumes", "cover-letters", "exports"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyData {
    pub path: String,
    /// Documents per collection in the old store.
    pub collections: Vec<(String, usize)>,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub files: usize,
    pub bytes: u64,
    pub documents: usize,
}

/// Where Job Hunter kept its data on this platform.
pub fn default_legacy_root() -> Option<PathBuf> {
    let base = BaseDirs::new()?;
    Some(if cfg!(target_os = "windows") {
        base.config_dir().join("JobHunter")
    } else if cfg!(target_os = "macos") {
        base.home_dir()
            .join("Library")
            .join("Application Support")
            .join("JobHunter")
    } else {
        base.data_local_dir().join("job-hunter")
    })
}

/// The old installation's data, if there is any worth importing.
pub fn detect(root: &Path) -> Option<LegacyData> {
    let database = root.join("database");
    let mut collections = Vec::new();
    for entry in std::fs::read_dir(&database).ok()?.flatten() {
        let path = entry.path();
        let name = path.file_stem()?.to_string_lossy().to_string();
        if path.extension().and_then(|e| e.to_str()) != Some("json") || name.starts_with('_') {
            continue;
        }
        let count = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
            .map(|docs| docs.len())
            .unwrap_or(0);
        if count > 0 {
            collections.push((name, count));
        }
    }
    if collections.is_empty() {
        return None;
    }
    collections.sort();
    let bytes = COPIED_DIRS.iter().map(|d| dir_size(&root.join(d))).sum();
    Some(LegacyData {
        path: root.to_string_lossy().to_string(),
        collections,
        bytes,
    })
}

/// True when this Offerpath installation has no hunt data yet, so an import
/// can't overwrite anything.
pub fn is_fresh(paths: &AppPaths) -> bool {
    // Not candidate_profiles or users: the app creates an empty one of each on
    // its first start, before anyone could have imported anything.
    ["jobs", "applications", "resumes", "experiences", "projects"]
        .iter()
        .all(|name| {
            std::fs::read_to_string(paths.database_dir().join(format!("{name}.json")))
                .ok()
                .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
                .map(|docs| docs.is_empty())
                .unwrap_or(true)
        })
}

/// The marker that asks the next start to import (see [`import_pending`]).
const PENDING_MARKER: &str = "import-legacy.pending";

/// Asks the next start to import the old data. The copy runs then, before the
/// store is opened, so nothing in memory can write over it.
pub fn request_import(paths: &AppPaths) -> CoreResult<()> {
    std::fs::write(paths.root.join(PENDING_MARKER), b"")?;
    Ok(())
}

/// At start-up, before `AppContext::init`: runs a requested import, once.
pub fn import_pending(paths: &AppPaths) -> Option<CoreResult<ImportReport>> {
    let marker = paths.root.join(PENDING_MARKER);
    if !marker.exists() {
        return None;
    }
    let _ = std::fs::remove_file(&marker);
    let root = default_legacy_root()?;
    Some(import(&root, paths))
}

/// Copies the old data into `paths`. Refuses unless Offerpath's own store is
/// still empty. The app must be restarted afterwards to load it.
pub fn import(from: &Path, paths: &AppPaths) -> CoreResult<ImportReport> {
    if !is_fresh(paths) {
        return Err(CoreError::Validation(
            "Offerpath already has hunt data on this computer, so the old data was not imported."
                .into(),
        ));
    }
    if detect(from).is_none() {
        return Err(CoreError::Validation(format!(
            "No Job Hunter data found in {}",
            from.display()
        )));
    }

    let mut report = ImportReport {
        files: 0,
        bytes: 0,
        documents: 0,
    };
    let old_root = from.to_string_lossy().to_string();
    let new_root = paths.root.to_string_lossy().to_string();

    for dir in COPIED_DIRS {
        copy_tree(&from.join(dir), &paths.root.join(dir), &mut report)?;
    }

    // Absolute paths inside stored documents now point at the new folder.
    for entry in std::fs::read_dir(paths.database_dir())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path)?;
        let rewritten = rewrite_paths(&raw, &old_root, &new_root);
        if let Ok(docs) = serde_json::from_str::<Vec<serde_json::Value>>(&rewritten) {
            report.documents += docs.len();
        }
        if rewritten != raw {
            std::fs::write(&path, rewritten)?;
        }
    }

    let settings = from.join("settings.json");
    if settings.exists() {
        let raw = std::fs::read_to_string(&settings)?;
        let mut value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| CoreError::Other(format!("old settings.json is not valid JSON: {e}")))?;
        if let Some(obj) = value.as_object_mut() {
            // Old server sign-ins: every device signs in to Offerpath fresh.
            obj.remove("backend");
            obj.remove("remote");
        }
        let text = rewrite_paths(&value.to_string(), &old_root, &new_root);
        std::fs::write(paths.settings_file(), text)?;
        report.files += 1;
    }

    tracing::info!(
        from = %from.display(),
        files = report.files,
        documents = report.documents,
        "imported Job Hunter data"
    );
    Ok(report)
}

/// Replaces the old root with the new one, both as plain text and as it
/// appears inside JSON strings (backslashes escaped).
fn rewrite_paths(text: &str, old_root: &str, new_root: &str) -> String {
    let escaped = |s: &str| s.replace('\\', "\\\\");
    text.replace(&escaped(old_root), &escaped(new_root))
        .replace(old_root, new_root)
}

fn copy_tree(from: &Path, to: &Path, report: &mut ImportReport) -> CoreResult<()> {
    if !from.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)?.flatten() {
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_tree(&source, &target, report)?;
        } else {
            report.bytes += std::fs::copy(&source, &target)?;
            report.files += 1;
        }
    }
    Ok(())
}

fn dir_size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| {
                    let p = e.path();
                    if p.is_dir() {
                        dir_size(&p)
                    } else {
                        e.metadata().map(|m| m.len()).unwrap_or(0)
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn old_install(dir: &Path) {
        std::fs::create_dir_all(dir.join("database")).unwrap();
        std::fs::create_dir_all(dir.join("resumes/generated/acme")).unwrap();
        std::fs::create_dir_all(dir.join("runs/r1")).unwrap();
        std::fs::write(dir.join("resumes/generated/acme/cv.pdf"), b"%PDF").unwrap();
        std::fs::write(dir.join("runs/r1/transcript.jsonl"), b"{}").unwrap();
        let pdf = dir.join("resumes/generated/acme/cv.pdf");
        let resumes = serde_json::json!([{ "id": "r1", "pdfPath": pdf.to_string_lossy() }]);
        std::fs::write(dir.join("database/resumes.json"), resumes.to_string()).unwrap();
        std::fs::write(
            dir.join("database/jobs.json"),
            r#"[{"id":"j1"},{"id":"j2"}]"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"mockMode":false,"backend":{"backendUrl":"http://old:8788"},"remote":{"relayUrl":"x"}}"#,
        )
        .unwrap();
    }

    #[test]
    fn detects_imports_and_rewrites_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("JobHunter");
        old_install(&old);
        let paths = AppPaths::at(tmp.path().join("Offerpath")).unwrap();

        let found = detect(&old).expect("old data");
        assert!(found.collections.contains(&("jobs".to_string(), 2)));

        let report = import(&old, &paths).unwrap();
        assert_eq!(report.documents, 3);

        // The document now points at the copied file, which exists.
        let resumes: Vec<serde_json::Value> = serde_json::from_str(
            &std::fs::read_to_string(paths.database_dir().join("resumes.json")).unwrap(),
        )
        .unwrap();
        let pdf = PathBuf::from(resumes[0]["pdfPath"].as_str().unwrap());
        assert!(pdf.starts_with(&paths.root), "{}", pdf.display());
        assert!(pdf.exists());

        // Run transcripts stay behind; old server sign-ins are dropped.
        assert!(!paths.root.join("runs/r1").exists());
        let settings: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(paths.settings_file()).unwrap()).unwrap();
        assert!(settings.get("backend").is_none() && settings.get("remote").is_none());
        assert_eq!(settings["mockMode"], false);

        // Never twice over existing data.
        assert!(import(&old, &paths).is_err());
    }

    #[test]
    fn nothing_to_import_without_documents() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(detect(tmp.path()).is_none());
    }
}
