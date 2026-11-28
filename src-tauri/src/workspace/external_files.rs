use super::vault::replace_file_atomically;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct ExternalFiles(Arc<Mutex<HashMap<PathBuf, String>>>);

#[derive(Serialize)]
pub(crate) struct ExternalFile {
    path: String,
    display_path: String,
    parent: String,
    name: String,
    text: String,
}

fn read_text(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Sélectionne un fichier texte.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("Ce fichier dépasse la limite de 2 Mio.".into());
    }
    if bytes.contains(&0) {
        return Err("Ce fichier ne peut pas être ouvert comme texte UTF-8.".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Ce fichier ne peut pas être ouvert comme texte UTF-8.".into())
}

fn register(
    files: &Mutex<HashMap<PathBuf, String>>,
    path: PathBuf,
) -> Result<ExternalFile, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let text = read_text(&path)?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Nom de fichier invalide.")?;
    let parent = path
        .parent()
        .and_then(|value| value.to_str())
        .ok_or("Dossier du fichier invalide.")?;
    let display = path.to_str().ok_or("Chemin de fichier invalide.")?;
    let response = ExternalFile {
        path: display.into(),
        display_path: if let Some(rest) = display.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{rest}")
        } else {
            display.strip_prefix(r"\\?\").unwrap_or(display).into()
        },
        parent: parent.into(),
        name: name.into(),
        text: text.clone(),
    };
    files
        .lock()
        .map_err(|error| error.to_string())?
        .entry(path)
        .or_insert(text);
    Ok(response)
}

#[tauri::command]
pub(crate) async fn choose_external_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
) -> Result<Option<ExternalFile>, String> {
    let files = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_title("Ouvrir un fichier dans Black Hole")
            .set_parent(&window)
            .blocking_pick_file()
            .map(|picked| {
                let path = picked.into_path().map_err(|error| error.to_string())?;
                register(&files, path)
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn startup_external_file(
    state: tauri::State<'_, ExternalFiles>,
) -> Result<Option<ExternalFile>, String> {
    static READ: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if READ.set(()).is_err() {
        return Ok(None);
    }
    std::env::args_os()
        .nth(1)
        .filter(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(|arg| register(&state.0, PathBuf::from(arg)))
        .transpose()
}

#[tauri::command]
pub(crate) fn save_external_file(
    state: tauri::State<'_, ExternalFiles>,
    path: PathBuf,
    content: String,
) -> Result<(), String> {
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err("Le fichier dépasse la limite de 2 Mio.".into());
    }
    let mut files = state.0.lock().map_err(|error| error.to_string())?;
    let snapshot = files
        .get_mut(&path)
        .ok_or("Ouvre ce fichier avant de le modifier.")?;
    if fs::canonicalize(&path).map_err(|error| error.to_string())? != path
        || read_text(&path)? != *snapshot
    {
        return Err("Ce fichier a changé sur le disque. Rouvre-le avant de l’enregistrer.".into());
    }
    replace_file_atomically(&path, &content).map_err(|error| error.to_string())?;
    *snapshot = content;
    Ok(())
}

#[tauri::command]
pub(crate) fn forget_external_file(state: tauri::State<'_, ExternalFiles>, path: PathBuf) {
    if let Ok(mut files) = state.0.lock() {
        files.remove(&path);
    }
}
