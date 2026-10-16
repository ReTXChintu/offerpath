//! Learning AI jobs: the server's AI calls, run on this desktop.
//!
//! The Offerpath server never runs AI. When a learning feature needs Claude
//! (a hint, grading, a curriculum), the API hands this desktop an `ai_job`
//! over the hub (`docs/hub-protocol.md`). It is run here with the local
//! Claude CLI and what the CLI printed goes back.
//!
//! These jobs are kept apart from the job hunt on purpose:
//! - they never go through the hunt dispatcher, the queue or approval gating;
//! - no Chrome, no MCP servers, no `--resume`, every file/shell/web tool
//!   denied, and an empty temporary working folder;
//! - their own small concurrency limit, so a hint never waits behind a hunt.
//!
//! The job is described by meaning (`CliJob`); the argument list is built
//! here and nothing else is ever run. `claude_args` mirrors `claudeCodeArgs`
//! in `packages/ai` exactly.

use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::claude::ClaudeCli;

/// Learning jobs that may run at once on this desktop.
pub const MAX_CONCURRENT_JOBS: usize = 2;

/// Every tool that touches files, commands or the network, denied. Mirrors
/// `CLAUDE_CODE_DENIED_TOOLS` in `packages/ai`.
pub const DENIED_TOOLS: &[&str] = &[
    "Bash",
    "BashOutput",
    "KillShell",
    "Read",
    "Write",
    "Edit",
    "NotebookEdit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
    "Task",
    "TodoWrite",
];

/// One prompt for the Claude CLI, as the server sends it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliJob {
    pub tool: String,
    pub system: Option<String>,
    pub conversation: String,
    pub json_schema: Option<Value>,
    pub model: String,
    pub timeout_ms: u64,
}

/// What a run left behind: exactly what the CLI printed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CliOutcome {
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

/// The argument list for one job. Change it only together with
/// `claudeCodeArgs` in `packages/ai/src/provider/claude-code/claude-code.provider.ts`.
pub fn claude_args(job: &CliJob) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--model".to_string(),
        job.model.clone(),
        "--disallowedTools".to_string(),
        DENIED_TOOLS.join(","),
    ];
    if let Some(system) = job.system.as_deref().filter(|s| !s.is_empty()) {
        args.push("--system-prompt".to_string());
        args.push(system.to_string());
    }
    if let Some(schema) = &job.json_schema {
        args.push("--json-schema".to_string());
        args.push(schema.to_string());
    }
    args
}

/// Why a job could not run at all (as opposed to Claude answering with an error).
#[derive(Debug, Clone, PartialEq)]
pub struct JobFailure(pub String);

impl std::fmt::Display for JobFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Checks a job before anything is started: only the Claude CLI, a sane
/// model name and a bounded timeout.
pub fn validate(job: &CliJob) -> Result<(), JobFailure> {
    if job.tool != "CLAUDE_CODE" {
        return Err(JobFailure(format!("unsupported tool {}", job.tool)));
    }
    let model_ok = !job.model.is_empty()
        && job.model.len() <= 120
        && job
            .model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-[]".contains(c));
    if !model_ok {
        return Err(JobFailure("invalid model name".into()));
    }
    if job.timeout_ms == 0 || job.timeout_ms > 15 * 60 * 1000 {
        return Err(JobFailure("invalid timeout".into()));
    }
    Ok(())
}

/// Runs one job with the local Claude CLI. The prompt goes over stdin, never
/// as an argument; stdout and stderr are read while it is written.
pub async fn run_job(
    cli: &ClaudeCli,
    job: &CliJob,
    cancel: CancellationToken,
) -> Result<CliOutcome, JobFailure> {
    validate(job)?;
    let workdir = tempfile::Builder::new()
        .prefix("offerpath-learning-")
        .tempdir()
        .map_err(|e| JobFailure(format!("could not create a working folder: {e}")))?;

    let mut cmd = cli.command();
    cmd.args(claude_args(job))
        .current_dir(workdir.path())
        // No MCP servers (so no Chrome), whatever the user's config says.
        .arg("--strict-mcp-config")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| JobFailure(format!("could not start Claude Code: {e}")))?;

    let mut stdin = child.stdin.take().expect("piped stdin");
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let input = job.conversation.clone();

    let writer = tokio::spawn(async move {
        let _ = stdin.write_all(input.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let out_reader = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf).await;
        buf
    });
    let err_reader = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let status = tokio::select! {
        status = child.wait() => status.map_err(|e| JobFailure(format!("Claude Code failed: {e}")))?,
        _ = tokio::time::sleep(Duration::from_millis(job.timeout_ms)) => {
            let _ = child.kill().await;
            return Err(JobFailure(format!("Claude Code did not finish within {}s", job.timeout_ms / 1000)));
        }
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            return Err(JobFailure("Cancelled".into()));
        }
    };
    let _ = writer.await;
    let stdout = out_reader.await.unwrap_or_default();
    let stderr = err_reader.await.unwrap_or_default();

    Ok(CliOutcome {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr)
            .chars()
            .take(4_000)
            .collect(),
        code: status.code(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> CliJob {
        CliJob {
            tool: "CLAUDE_CODE".into(),
            system: Some("S".into()),
            conversation: "Q".into(),
            json_schema: Some(serde_json::json!({ "type": "object" })),
            model: "haiku".into(),
            timeout_ms: 1,
        }
    }

    #[test]
    fn args_match_the_servers_reference_list() {
        // The same expectation as packages/ai's claude-code.test.ts.
        assert_eq!(
            claude_args(&job()),
            vec![
                "-p",
                "--output-format",
                "json",
                "--model",
                "haiku",
                "--disallowedTools",
                &DENIED_TOOLS.join(","),
                "--system-prompt",
                "S",
                "--json-schema",
                r#"{"type":"object"}"#,
            ]
        );
    }

    #[test]
    fn plain_text_jobs_carry_no_schema_or_system() {
        let mut j = job();
        j.system = None;
        j.json_schema = None;
        let args = claude_args(&j);
        assert!(!args.contains(&"--json-schema".to_string()));
        assert!(!args.contains(&"--system-prompt".to_string()));
    }

    #[test]
    fn the_wire_shape_is_the_servers() {
        let parsed: CliJob = serde_json::from_value(serde_json::json!({
            "tool": "CLAUDE_CODE",
            "system": null,
            "conversation": "hello",
            "jsonSchema": null,
            "model": "sonnet",
            "timeoutMs": 180000
        }))
        .unwrap();
        assert_eq!(parsed.model, "sonnet");
        assert_eq!(parsed.timeout_ms, 180_000);
    }

    #[test]
    fn refuses_anything_but_a_bounded_claude_job() {
        let mut j = job();
        j.tool = "CODEX".into();
        assert!(validate(&j).is_err());
        let mut j = job();
        j.model = "sonnet; rm -rf /".into();
        assert!(validate(&j).is_err());
        let mut j = job();
        j.timeout_ms = 0;
        assert!(validate(&j).is_err());
        assert!(validate(&job()).is_ok());
    }
}
