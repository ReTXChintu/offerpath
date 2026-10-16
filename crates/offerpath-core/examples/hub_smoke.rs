//! A headless desktop for an end-to-end check against a running API: signs
//! in, holds the hub connection, and runs learning AI jobs with this
//! machine's real Claude CLI. `scripts/hub-smoke.mjs` drives it.
//!
//!   OFFERPATH_SERVER_URL=http://127.0.0.1:50015 SMOKE_EMAIL=... SMOKE_PASSWORD=... \
//!   cargo run -p offerpath-core --example hub_smoke
//!
//! Uses a throwaway data folder and keeps the device token in memory.

use std::time::Duration;

use offerpath_core::logging::{self, LogBuffer};
use offerpath_core::paths::AppPaths;
use offerpath_core::remote::RemoteClient;
use offerpath_core::AppContext;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data = tempfile::Builder::new()
        .prefix("offerpath-smoke-")
        .tempdir()?;
    std::env::set_var("OFFERPATH_MEMORY_SECRETS", "1");
    std::env::set_var("MOCK_MODE", "false");
    let server = offerpath_core::backend_url::configured();
    let email = std::env::var("SMOKE_EMAIL")?;
    let password = std::env::var("SMOKE_PASSWORD")?;

    let paths = AppPaths::at(data.path().to_path_buf())?;
    let logs = LogBuffer::new(500, None);
    logging::init(logs.clone());
    let ctx = AppContext::init(paths, logs).await?;

    ctx.sync
        .configure(&server, &email, &password, false, "Smoke desktop", true)
        .await?;
    let remote = RemoteClient::new(ctx.clone());
    tokio::spawn(remote.clone().run());
    remote.credentials_changed().await;
    println!("hub_smoke: signed in to {server} as {email}; waiting for jobs");

    let seconds = std::env::var("SMOKE_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(240);
    tokio::time::sleep(Duration::from_secs(seconds)).await;
    Ok(())
}
