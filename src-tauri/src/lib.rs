//! OCC Secure Exports — Tauri entry point.
//!
//! The WebView talks to the core only through the commands registered below.
//! The single outbound network path is the S3 client inside `s3`/`download`;
//! the WebView itself is locked down by a strict CSP in `tauri.conf.json`.

mod commands;
pub mod crypto;
pub mod download;
pub mod error;
pub mod profile;
pub mod s3;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::generate_keypair,
            commands::save_text_file,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::profile_public_key,
            commands::export_rescue_kit,
            commands::secret_status,
            commands::connect,
            commands::check_keys,
            commands::list_objects,
            commands::disconnect,
            commands::download_decrypt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
