//! HTTP client for the Offerpath API (`apps/api`). Two concerns live here:
//!
//! - **Account/device auth** (`register_account`/`login_account`/
//!   `register_device`), a one-time flow that ends with a device token.
//! - **Data sync** (`BackendClientHandle::upsert`/`delete`/`fetch_all`) on
//!   `/api/v1/data/...`, the same three operations Job Hunter's backend had.
//!
//! Every function takes the server's root address (`backend_url::configured`);
//! the API lives under `/api` on it.

use serde::Deserialize;
use serde_json::Value;

use crate::backend_url::api_base as api;
use crate::error::{CoreError, CoreResult};

/// Normalizes and validates a backend base URL the same way the mobile
/// relay's address is validated: must be `https://` unless the caller
/// explicitly allows an insecure address for local testing.
pub fn normalize_backend_url(backend_url: &str, allow_insecure: bool) -> CoreResult<String> {
    let url = backend_url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err(CoreError::Validation(
            "Enter your backend server's address".into(),
        ));
    }
    if url.starts_with("http://") {
        if !allow_insecure {
            return Err(CoreError::Validation("This address is not encrypted (http://). Use https://, or explicitly allow an insecure address for local testing.".into()));
        }
    } else if !url.starts_with("https://") {
        return Err(CoreError::Validation("The backend address must start with https:// (or http:// only if you explicitly allow an insecure address for local testing)".into()));
    }
    Ok(url.to_string())
}

/// Pings `/healthz`, which requires no auth -- just confirms the address is
/// reachable before the caller commits credentials to it.
pub async fn ping_backend(http: &reqwest::Client, base_url: &str) -> CoreResult<()> {
    let resp = http
        .get(format!("{}/v1/health/live", api(base_url)))
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(CoreError::BackendUnavailable {
            message: format!("backend returned {}", resp.status()),
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    #[allow(dead_code)]
    user_id: String,
    access_token: String,
}

pub async fn register_account(
    http: &reqwest::Client,
    base_url: &str,
    email: &str,
    password: &str,
) -> CoreResult<String> {
    let resp = http
        .post(format!("{}/v1/auth/register", api(base_url)))
        .json(&serde_json::json!({
            "email": email,
            "password": password,
            "displayName": display_name_for(email),
        }))
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    Ok(parse_backend_response::<AuthResponse>(resp)
        .await?
        .access_token)
}

pub async fn login_account(
    http: &reqwest::Client,
    base_url: &str,
    email: &str,
    password: &str,
) -> CoreResult<String> {
    let resp = http
        .post(format!("{}/v1/auth/login", api(base_url)))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    Ok(parse_backend_response::<AuthResponse>(resp)
        .await?
        .access_token)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterDeviceResponse {
    device_id: String,
    device_token: String,
}

/// Registers this desktop as a device on the account behind `access_token`,
/// returning `(device_id, device_token)`. The device token is what every
/// later call (including data sync) authenticates with -- the access token
/// and password are never needed again after this.
pub async fn register_device(
    http: &reqwest::Client,
    base_url: &str,
    access_token: &str,
    device_name: &str,
) -> CoreResult<(String, String)> {
    let platform = std::env::consts::OS.to_string();
    let resp = http
        .post(format!("{}/v1/devices/register", api(base_url)))
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "name": device_name, "kind": "desktop", "platform": platform }))
        .send()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    let device = parse_backend_response::<RegisterDeviceResponse>(resp).await?;
    Ok((device.device_id, device.device_token))
}

#[derive(Deserialize)]
struct FetchAllResponse {
    documents: Vec<Value>,
}

/// The data-sync half: mirrors `store/mongo.rs`'s `upsert`/`delete`/
/// `fetch_all` exactly, so `SyncWorker` calls it the same way regardless of
/// which one backs it.
#[derive(Clone)]
pub struct BackendClientHandle {
    http: reqwest::Client,
    base_url: String,
    device_token: String,
    label: String,
}

impl BackendClientHandle {
    pub fn new(
        http: reqwest::Client,
        base_url: String,
        device_token: String,
        label: String,
    ) -> Self {
        Self {
            http,
            base_url,
            device_token,
            label,
        }
    }

    /// Confirms the device token is still valid (not revoked) and the
    /// backend is reachable, by calling an authenticated endpoint.
    pub async fn ping(&self) -> CoreResult<()> {
        let resp = self
            .http
            .get(format!("{}/v1/devices", api(&self.base_url)))
            .bearer_auth(&self.device_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            parse_backend_response::<Value>(resp).await.map(|_| ())
        }
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub async fn upsert(&self, collection: &str, id: &str, value: &Value) -> CoreResult<()> {
        let resp = self
            .http
            .put(format!("{}/v1/data/{collection}/{id}", api(&self.base_url)))
            .bearer_auth(&self.device_token)
            .json(value)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        parse_backend_response::<Value>(resp).await.map(|_| ())
    }

    pub async fn delete(&self, collection: &str, id: &str) -> CoreResult<()> {
        let resp = self
            .http
            .delete(format!("{}/v1/data/{collection}/{id}", api(&self.base_url)))
            .bearer_auth(&self.device_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        parse_backend_response::<Value>(resp).await.map(|_| ())
    }

    pub async fn fetch_all(&self, collection: &str) -> CoreResult<Vec<Value>> {
        let resp = self
            .http
            .get(format!("{}/v1/data/{collection}", api(&self.base_url)))
            .bearer_auth(&self.device_token)
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        Ok(parse_backend_response::<FetchAllResponse>(resp)
            .await?
            .documents)
    }
}

/// An API reply passed through as it came: the learning pages read problem
/// details (`ai-unavailable`, `assistance-gated`, …) themselves.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ApiReply {
    pub status: u16,
    pub body: Option<Value>,
}

/// Checks a path the webview asks to call: one API path under `/api/v1`,
/// never another host or a way out of it.
pub fn valid_api_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && !path.contains("..")
        && !path.contains('\\')
        && !path.contains("://")
        && !path.chars().any(|c| c.is_control() || c == '#')
}

impl BackendClientHandle {
    /// One request to the API with this desktop's device token, for the
    /// learning pages. The token never reaches the webview.
    pub async fn request(
        &self,
        http: &reqwest::Client,
        method: &str,
        path: &str,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> CoreResult<ApiReply> {
        if !valid_api_path(path) {
            return Err(CoreError::Validation(format!("Not an API path: {path}")));
        }
        let method = match method {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "PATCH" => reqwest::Method::PATCH,
            "DELETE" => reqwest::Method::DELETE,
            other => return Err(CoreError::Validation(format!("Unsupported method {other}"))),
        };
        let mut req = http
            .request(method, format!("{}/v1{path}", api(&self.base_url)))
            .bearer_auth(&self.device_token);
        if let Some(key) = idempotency_key {
            req = req.header("Idempotency-Key", key);
        }
        if let Some(body) = body {
            req = req.json(body);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| CoreError::Network(e.to_string()))?;
        let body = if bytes.is_empty() {
            None
        } else {
            serde_json::from_slice(&bytes).ok()
        };
        Ok(ApiReply { status, body })
    }
}

/// The API answers errors as problem details: `{ type, title, status, detail, errors }`.
#[derive(Deserialize)]
struct ErrBody {
    title: Option<String>,
    detail: Option<String>,
}

impl ErrBody {
    fn message(self) -> Option<String> {
        self.detail.or(self.title).filter(|m| !m.is_empty())
    }
}

/// The name an account starts with: the part of the email before the @.
fn display_name_for(email: &str) -> String {
    let name = email.split('@').next().unwrap_or(email).trim();
    if name.is_empty() {
        email.to_string()
    } else {
        name.to_string()
    }
}

async fn parse_backend_response<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
) -> CoreResult<T> {
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| CoreError::Network(e.to_string()))?;
    if !status.is_success() {
        let message = serde_json::from_slice::<ErrBody>(&bytes)
            .ok()
            .and_then(ErrBody::message)
            .unwrap_or_else(|| format!("backend returned {status}"));
        // The server refused this particular request (e.g. a collection an
        // older server doesn't know yet); retrying won't change that.
        if status == reqwest::StatusCode::BAD_REQUEST {
            return Err(CoreError::Validation(message));
        }
        return Err(CoreError::BackendUnavailable { message });
    }
    serde_json::from_slice(&bytes)
        .map_err(|e| CoreError::Other(format!("unexpected response from backend: {e}")))
}

/// Mask a device token or similar bearer credential for a display label:
/// keeps the backend URL, hides everything else.
pub fn label_for(base_url: &str, account_email: &str) -> String {
    if account_email.is_empty() {
        base_url.to_string()
    } else {
        format!("{account_email} @ {base_url}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_api_paths_reach_the_server() {
        assert!(valid_api_path("/today"));
        assert!(valid_api_path("/concepts/abc/chat"));
        assert!(valid_api_path("/technologies?search=react%20native"));
        assert!(!valid_api_path("today"));
        assert!(!valid_api_path("//evil.example.com/x"));
        assert!(!valid_api_path("/../admin"));
        assert!(!valid_api_path("/x\\y"));
        assert!(!valid_api_path("/redirect?to=http://evil"));
        assert!(!valid_api_path("/x\ny"));
    }

    #[test]
    fn backend_url_is_normalized_and_insecure_urls_are_refused_by_default() {
        assert_eq!(
            normalize_backend_url("https://backend.example.com/", false).unwrap(),
            "https://backend.example.com"
        );
        assert!(normalize_backend_url("http://localhost:8788", false).is_err());
        assert_eq!(
            normalize_backend_url("http://localhost:8788", true).unwrap(),
            "http://localhost:8788"
        );
        assert!(normalize_backend_url("not-a-url", false).is_err());
        assert!(normalize_backend_url("  ", false).is_err());
    }

    #[test]
    fn label_combines_email_and_url_or_falls_back_to_url_alone() {
        assert_eq!(
            label_for("https://backend.example.com", "alice@example.com"),
            "alice@example.com @ https://backend.example.com"
        );
        assert_eq!(
            label_for("https://backend.example.com", ""),
            "https://backend.example.com"
        );
    }
}
