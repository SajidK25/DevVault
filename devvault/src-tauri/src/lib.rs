mod backup;
mod commands;
mod crypto;
mod db;
mod error;
mod vault;

use tauri::Manager;
use vault::VaultState;

/// `~/.devvault` — holds the SQLite DB (and, in later steps, backups).
fn vault_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".devvault")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMABUF/GPU renderer crashes (and respawns in a loop) on many
    // Linux GPU/compositor combos. Forcing the software path is the standard
    // fix and costs nothing for a small offline app.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    let dir = vault_dir();
    std::fs::create_dir_all(&dir).expect("failed to create ~/.devvault");
    let conn = db::open(&dir.join("devvault.db")).expect("failed to open vault db");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::new(conn))
        .invoke_handler(tauri::generate_handler![
            commands::is_setup,
            commands::is_unlocked,
            commands::vault_status,
            commands::setup_master,
            commands::unlock,
            commands::lock,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::list_entries,
            commands::get_entry,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::search,
            commands::backup_now,
            commands::list_backups,
            commands::restore_backup,
            commands::export_encrypted,
            commands::import_encrypted,
            commands::export_plaintext,
            commands::open_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Automatic backup on app close (spec §5), only if unlocked.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<VaultState>() {
                    if state.is_unlocked() {
                        if let Ok(conn) = state.db.lock() {
                            backup::auto_backup(&conn);
                        }
                    }
                }
            }
        });
}
