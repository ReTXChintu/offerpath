//! Runs cut off by the app closing are closed at the next start, so the
//! history never shows them running forever.

use offerpath_core::context::AppContext;
use offerpath_core::domain::*;

#[tokio::test]
async fn runs_left_open_by_a_shutdown_are_closed_as_interrupted() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = AppContext::init_mock(dir.path().to_path_buf())
        .await
        .unwrap();

    let open = AgentRun::new(LOCAL_USER_ID, RunKind::InboxCheck, true);
    let mut done = AgentRun::new(LOCAL_USER_ID, RunKind::JobHunt, true);
    done.state = AgentState::Completed;
    done.finished_at = Some(chrono::Utc::now());
    ctx.store.put(&open).unwrap();
    ctx.store.put(&done).unwrap();

    assert_eq!(ctx.close_interrupted_runs().unwrap(), 1);
    let open: AgentRun = ctx.store.require(&open.id).unwrap();
    assert_eq!(open.state, AgentState::Failed);
    assert!(open.finished_at.is_some());
    assert!(open.error.unwrap().starts_with("Interrupted"));
    let done: AgentRun = ctx.store.require(&done.id).unwrap();
    assert_eq!(done.state, AgentState::Completed);

    // Nothing left to close.
    assert_eq!(ctx.close_interrupted_runs().unwrap(), 0);
}
