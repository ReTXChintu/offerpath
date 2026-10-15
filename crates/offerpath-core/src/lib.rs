//! Offerpath core.
//!
//! Phase 2 moves `job-hunter-core` in here: the hunt pipeline, the Claude CLI
//! runner, the local store, sync, approval gating, and the executor for
//! learning AI jobs. Until then it only knows its own name and version.

/// Product name, shown in logs and the desktop window title.
pub const PRODUCT_NAME: &str = "Offerpath";

/// The repo-wide version (`pnpm release` stamps it into the workspace Cargo.toml).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semver() {
        let parts: Vec<&str> = VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "expected x.y.z, got {VERSION}");
        assert!(parts.iter().all(|p| p.parse::<u32>().is_ok()));
    }
}
