/// The repo-wide version, for the About screen and the server handshake.
#[tauri::command]
fn app_version() -> &'static str {
    offerpath_core::VERSION
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running Offerpath");
}
