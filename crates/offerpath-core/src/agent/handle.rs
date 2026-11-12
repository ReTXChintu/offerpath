use std::sync::Arc;

use tokio::sync::{watch, Mutex, RwLock};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::events::EventBus;
use super::state::can_transition;
use crate::domain::*;
use crate::error::{CoreError, CoreResult};
use crate::util::now;

/// Live agent state shared between the orchestrator task and the UI commands.
pub struct AgentHandle {
    status: RwLock<AgentStatus>,
    cancel: Mutex<Option<CancellationToken>>,
    task: Mutex<Option<JoinHandle<()>>>,
    paused: watch::Sender<bool>,
    pub bus: EventBus,
}

impl Default for AgentHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentHandle {
    pub fn new() -> Self {
        let (paused, _) = watch::channel(false);
        Self {
            status: RwLock::new(AgentStatus::default()),
            cancel: Mutex::new(None),
            task: Mutex::new(None),
            paused,
            bus: EventBus::new(),
        }
    }

    pub async fn status(&self) -> AgentStatus {
        self.status.read().await.clone()
    }

    pub async fn is_busy(&self) -> bool {
        let s = self.status.read().await;
        s.state.is_running() || s.paused
    }

    /// Claim the agent for a new run. Fails when a run is in progress.
    pub async fn begin(&self, run: &AgentRun) -> CoreResult<CancellationToken> {
        let mut status = self.status.write().await;
        if status.state.is_running() || status.paused {
            return Err(CoreError::AgentBusy(format!(
                "agent is {}",
                status.state.as_str()
            )));
        }
        if !can_transition(status.state, AgentState::Initializing) {
            return Err(CoreError::InvalidTransition(format!(
                "{} -> INITIALIZING",
                status.state.as_str()
            )));
        }
        let token = CancellationToken::new();
        *self.cancel.lock().await = Some(token.clone());
        self.paused.send_replace(false);
        *status = AgentStatus {
            state: AgentState::Initializing,
            run_id: Some(run.id.clone()),
            run_kind: Some(run.kind),
            current_activity: Some("Starting".into()),
            progress: None,
            stats: RunStats::default(),
            started_at: Some(run.started_at),
            error: None,
            mock: run.mock,
            paused: false,
            queued: status.queued,
        };
        self.bus.emit_status(status.clone());
        Ok(token)
    }

    /// How many tasks wait in the queue; shown with the status everywhere.
    pub async fn set_queued(&self, n: u32) {
        let mut status = self.status.write().await;
        if status.queued != n {
            status.queued = n;
            self.bus.emit_status(status.clone());
        }
    }

    pub async fn set_task(&self, task: JoinHandle<()>) {
        *self.task.lock().await = Some(task);
    }

    /// Whether `run_id` still owns the agent. Once a run stops for the user
    /// (e.g. WAITING_FOR_APPROVAL), the queue may start the next run before
    /// the first one's task has wrapped up; from then on the first run must
    /// not touch the shared state.
    fn owns(status: &AgentStatus, run_id: &str) -> bool {
        status
            .run_id
            .as_deref()
            .is_none_or(|current| current == run_id)
    }

    pub async fn transition(&self, to: AgentState, run_id: &str) -> CoreResult<()> {
        let mut status = self.status.write().await;
        if !Self::owns(&status, run_id) {
            return Err(CoreError::InvalidTransition(format!(
                "run {run_id} no longer owns the agent (another run started)"
            )));
        }
        let from = status.state;
        if !can_transition(from, to) {
            return Err(CoreError::InvalidTransition(format!(
                "{} -> {}",
                from.as_str(),
                to.as_str()
            )));
        }
        if from != to {
            status.state = to;
            if to.is_terminal() {
                status.paused = false;
            }
            self.bus.emit(
                AgentEvent::new(
                    run_id,
                    EventLevel::Info,
                    "STATE_CHANGED",
                    format!("{} → {}", from.as_str(), to.as_str()),
                )
                .with_data(serde_json::json!({ "from": from, "to": to })),
            );
            self.bus.emit_status(status.clone());
        }
        Ok(())
    }

    pub async fn update<F: FnOnce(&mut AgentStatus)>(&self, f: F) {
        let mut status = self.status.write().await;
        f(&mut status);
        self.bus.emit_status(status.clone());
    }

    pub async fn finish(&self, final_state: AgentState, error: Option<String>, run_id: &str) {
        let mut status = self.status.write().await;
        let from = status.state;
        // A newer run already owns the agent: record this run's end, but
        // leave the newer run's state, stop token and pause flag alone.
        let current = Self::owns(&status, run_id);
        if current {
            status.state = final_state;
            status.error = error.clone();
            status.paused = false;
            status.current_activity = None;
            status.progress = None;
        }
        drop(status);
        if current {
            *self.cancel.lock().await = None;
            self.paused.send_replace(false);
        }
        let level = if error.is_some() {
            EventLevel::Error
        } else {
            EventLevel::Success
        };
        self.bus.emit(
            AgentEvent::new(
                run_id,
                level,
                "RUN_FINISHED",
                error
                    .clone()
                    .unwrap_or_else(|| format!("Finished: {}", final_state.as_str())),
            )
            .with_data(serde_json::json!({ "from": from, "to": final_state, "at": now() })),
        );
        self.bus.emit_status(self.status.read().await.clone());
    }

    pub async fn request_stop(&self) -> bool {
        let token = self.cancel.lock().await.clone();
        self.paused.send_replace(false);
        match token {
            Some(t) => {
                t.cancel();
                let mut status = self.status.write().await;
                if status.state.is_running() || status.paused {
                    status.state = AgentState::Stopping;
                    status.paused = false;
                    status.current_activity = Some("Stopping".into());
                    self.bus.emit_status(status.clone());
                }
                true
            }
            None => false,
        }
    }

    pub async fn pause(&self) -> CoreResult<()> {
        let mut status = self.status.write().await;
        if !status.state.is_running() {
            return Err(CoreError::InvalidTransition("agent is not running".into()));
        }
        status.paused = true;
        self.paused.send_replace(true);
        self.bus.emit_status(status.clone());
        if let Some(run_id) = status.run_id.clone() {
            self.bus.emit(AgentEvent::new(
                &run_id,
                EventLevel::Warn,
                "MESSAGE",
                "Pause requested; the agent will pause after the current step",
            ));
        }
        Ok(())
    }

    pub async fn resume(&self) -> CoreResult<()> {
        let mut status = self.status.write().await;
        if !status.paused {
            return Err(CoreError::InvalidTransition("agent is not paused".into()));
        }
        status.paused = false;
        self.paused.send_replace(false);
        self.bus.emit_status(status.clone());
        if let Some(run_id) = status.run_id.clone() {
            self.bus.emit(AgentEvent::new(
                &run_id,
                EventLevel::Info,
                "MESSAGE",
                "Resumed",
            ));
        }
        Ok(())
    }

    /// Await here between units of work; returns Err(Cancelled) if stopped
    /// while paused.
    pub async fn checkpoint(&self, cancel: &CancellationToken) -> CoreResult<()> {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let mut rx = self.paused.subscribe();
        if *rx.borrow() {
            let previous = {
                let mut status = self.status.write().await;
                let prev = status.state;
                if can_transition(prev, AgentState::Paused) {
                    status.state = AgentState::Paused;
                    status.current_activity = Some("Paused".into());
                    self.bus.emit_status(status.clone());
                }
                prev
            };
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => return Err(CoreError::Cancelled),
                    changed = rx.changed() => {
                        if changed.is_err() || !*rx.borrow() { break; }
                    }
                }
            }
            let mut status = self.status.write().await;
            if status.state == AgentState::Paused {
                status.state = previous;
                status.current_activity = None;
                self.bus.emit_status(status.clone());
            }
        }
        Ok(())
    }
}

pub type SharedHandle = Arc<AgentHandle>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn begin_rejects_concurrent_runs_and_finish_releases() {
        let h = AgentHandle::new();
        let run = AgentRun::new("u", RunKind::JobHunt, true);
        let token = h.begin(&run).await.unwrap();
        assert!(h.begin(&run).await.is_err());
        h.transition(AgentState::Discovering, &run.id)
            .await
            .unwrap();
        assert!(h.transition(AgentState::Applying, &run.id).await.is_err());
        assert!(h.request_stop().await);
        assert!(token.is_cancelled());
        h.finish(AgentState::Completed, None, &run.id).await;
        assert_eq!(h.status().await.state, AgentState::Completed);
        assert!(h.begin(&run).await.is_ok());
    }

    /// What happened on 2026-11-12: a hunt stopped for approval, the queue
    /// started the next hunt, then the first hunt's task finished. Its
    /// finish must not release the agent (or the queue starts a third run
    /// alongside the second), nor take the second run's stop token.
    #[tokio::test]
    async fn a_finished_run_cannot_clobber_the_next_one() {
        let h = AgentHandle::new();
        let first = AgentRun::new("u", RunKind::JobHunt, true);
        h.begin(&first).await.unwrap();
        h.transition(AgentState::Discovering, &first.id)
            .await
            .unwrap();
        h.transition(AgentState::Extracting, &first.id)
            .await
            .unwrap();
        h.transition(AgentState::Analyzing, &first.id)
            .await
            .unwrap();
        h.transition(AgentState::PreparingApplications, &first.id)
            .await
            .unwrap();
        h.transition(AgentState::WaitingForApproval, &first.id)
            .await
            .unwrap();
        assert!(!h.is_busy().await);

        let second = AgentRun::new("u", RunKind::JobHunt, true);
        let token = h.begin(&second).await.unwrap();
        h.finish(AgentState::WaitingForApproval, None, &first.id)
            .await;

        let status = h.status().await;
        assert_eq!(status.state, AgentState::Initializing);
        assert_eq!(status.run_id.as_deref(), Some(second.id.as_str()));
        assert!(h.is_busy().await, "the queue must not start a third run");
        let third = AgentRun::new("u", RunKind::Application, true);
        assert!(h.begin(&third).await.is_err());
        // The old run can't drive the state either.
        assert!(h
            .transition(AgentState::Completed, &first.id)
            .await
            .is_err());
        // Stop still reaches the second run.
        assert!(h.request_stop().await);
        assert!(token.is_cancelled());
        h.transition(AgentState::Completed, &second.id)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn pause_blocks_checkpoint_until_resumed() {
        let h = Arc::new(AgentHandle::new());
        let run = AgentRun::new("u", RunKind::JobHunt, true);
        let token = h.begin(&run).await.unwrap();
        h.transition(AgentState::Discovering, &run.id)
            .await
            .unwrap();
        h.pause().await.unwrap();
        let h2 = h.clone();
        let t = token.clone();
        let waiter = tokio::spawn(async move { h2.checkpoint(&t).await });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(h.status().await.state, AgentState::Paused);
        h.resume().await.unwrap();
        waiter.await.unwrap().unwrap();
        assert_eq!(h.status().await.state, AgentState::Discovering);
    }
}
