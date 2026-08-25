#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The frontend is embedded by Tauri at compile time.
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running TheMarble");
}
