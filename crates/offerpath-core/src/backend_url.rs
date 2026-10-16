//! The one server address this desktop build talks to.
//!
//! There is no URL field in the app: the address is baked in when the
//! installer is built (CI sets `OFFERPATH_SERVER_URL` from a GitHub secret,
//! see `.github/workflows/release.yml`), e.g. `http://203.0.113.10:50005`.
//! Data sync (`store::sync`), the hub connection (`remote::client`) and
//! update checks all use it.
//!
//! Resolution order:
//! 1. `OFFERPATH_SERVER_URL` at **compile time** (release builds).
//! 2. `OFFERPATH_SERVER_URL` at **run time** (the repo's root `.env` in
//!    development, loaded by `AppContext::init`).
//! 3. An API running locally: `http://127.0.0.1:<OFFERPATH_API_PORT>`, else
//!    [`DEV_DEFAULT`].
//!
//! The address is chosen by whoever builds the app, so it is trusted as-is:
//! plain `http://<ip>:<port>` is allowed.

/// Used only when no address was provided at build or run time.
pub const DEV_DEFAULT: &str = "http://127.0.0.1:50005";

/// Every API route lives under this path on the server.
pub const API_PREFIX: &str = "/api";

const ENV_KEY: &str = "OFFERPATH_SERVER_URL";

fn clean(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(API_PREFIX).unwrap_or(url);
    (!url.is_empty()).then(|| url.to_string())
}

fn local_server() -> String {
    std::env::var("OFFERPATH_API_PORT")
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok())
        .map(|port| format!("http://127.0.0.1:{port}"))
        .unwrap_or_else(|| DEV_DEFAULT.to_string())
}

/// The server's root address (scheme, host, port), without a trailing slash.
pub fn configured() -> String {
    option_env!("OFFERPATH_SERVER_URL")
        .and_then(clean)
        .or_else(|| std::env::var(ENV_KEY).ok().as_deref().and_then(clean))
        .unwrap_or_else(local_server)
}

/// The base the API clients append `/v1/...` to: the server root plus `/api`.
pub fn api_base(server: &str) -> String {
    format!("{}{API_PREFIX}", clean(server).unwrap_or_default())
}

/// True when the address was fixed at build time (a CI/release build).
pub fn is_built_in() -> bool {
    option_env!("OFFERPATH_SERVER_URL")
        .and_then(clean)
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_trims_whitespace_slashes_and_a_pasted_api_suffix() {
        assert_eq!(
            clean(" http://10.0.0.5:50005/ ").as_deref(),
            Some("http://10.0.0.5:50005")
        );
        assert_eq!(
            clean("http://10.0.0.5:50005/api/").as_deref(),
            Some("http://10.0.0.5:50005")
        );
        assert_eq!(clean("   "), None);
    }

    #[test]
    fn the_api_lives_under_api() {
        assert_eq!(
            api_base("http://10.0.0.5:50005"),
            "http://10.0.0.5:50005/api"
        );
        assert_eq!(
            api_base("http://10.0.0.5:50005/api"),
            "http://10.0.0.5:50005/api"
        );
    }

    #[test]
    fn a_compiled_in_address_wins() {
        if let Some(built) = option_env!("OFFERPATH_SERVER_URL").and_then(clean) {
            assert!(is_built_in());
            assert_eq!(configured(), built);
        }
    }

    #[test]
    fn configured_is_never_empty() {
        assert!(!configured().is_empty());
    }
}
