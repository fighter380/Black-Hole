#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::process::Command;

mod studio;
mod updates;
mod workspace;

use studio::{arduino, python, serial};
use workspace::{source_control, vault};

fn command_without_console(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(python::RunningProcess::default())
        .manage(serial::SerialMonitor::default())
        .manage(updates::DownloadedUpdate::default())
        .invoke_handler(tauri::generate_handler![
            vault::choose_vault_folder,
            source_control::git_status,
            source_control::git_apply,
            vault::get_default_vault,
            vault::scan_vault,
            vault::list_vault_folders,
            vault::read_file,
            vault::read_web_files,
            vault::save_file,
            vault::create_web_project,
            vault::delete_file,
            vault::list_graph_links,
            vault::set_graph_link,
            vault::rename_file,
            python::run_python,
            python::stop_python,
            arduino::create_arduino_project,
            arduino::compile_arduino,
            arduino::upload_arduino,
            arduino::read_arduino_schematic,
            arduino::save_arduino_schematic,
            serial::list_serial_ports,
            serial::serial_connect,
            serial::serial_send,
            serial::serial_disconnect,
            updates::app_release_info,
            updates::check_app_update,
            updates::download_app_update,
            updates::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de Second Brain Black Hole");
}
