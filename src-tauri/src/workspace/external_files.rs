use super::vault::replace_file_atomically;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

enum OpenedFile {
    Text(String),
    Image,
}

#[derive(Default)]
pub(crate) struct ExternalFiles {
    files: Mutex<HashMap<(String, PathBuf), OpenedFile>>,
    pending: Mutex<HashMap<String, Result<ExternalFile, String>>>,
}

#[derive(Serialize)]
pub(crate) struct ExternalFile {
    path: String,
    display_path: String,
    parent: String,
    name: String,
    text: Option<String>,
    image_mime: Option<&'static str>,
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn read_bytes(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Sélectionne un fichier.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "Ce fichier dépasse la limite de {} Mio.",
            limit / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn read_text(path: &Path) -> Result<String, String> {
    let bytes = read_bytes(path, MAX_TEXT_BYTES)?;
    if bytes.contains(&0) {
        return Err("Ce fichier ne peut pas être ouvert comme texte UTF-8.".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Ce fichier ne peut pas être ouvert comme texte UTF-8.".into())
}

fn register(state: &ExternalFiles, label: &str, path: PathBuf) -> Result<ExternalFile, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let image_mime = image_mime(&path);
    let text = if image_mime.is_none() {
        Some(read_text(&path)?)
    } else {
        None
    };
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
        image_mime,
    };
    state
        .files
        .lock()
        .map_err(|error| error.to_string())?
        .entry((label.into(), path))
        .or_insert_with(|| text.map_or(OpenedFile::Image, OpenedFile::Text));
    Ok(response)
}

pub(crate) fn open_quick_file(app: &tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
    let label = format!("quick-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    let state = app.state::<ExternalFiles>();
    let file = register(&state, &label, path);
    let title = file
        .as_ref()
        .map(|file| file.name.as_str())
        .unwrap_or("Édition rapide");
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("quick-edit.html".into()))
        .title(format!("{title} — Black Hole"))
        .inner_size(840.0, 590.0)
        .min_inner_size(420.0, 300.0)
        .center();
    state
        .pending
        .lock()
        .map_err(|error| error.to_string())?
        .insert(label.clone(), file);
    if let Err(error) = builder.build() {
        state.remove_window(&label);
        return Err(error.to_string());
    }
    Ok(())
}

impl ExternalFiles {
    pub(crate) fn remove_window(&self, label: &str) {
        if let Ok(mut files) = self.files.lock() {
            files.retain(|(owner, _), _| owner != label);
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(label);
        }
    }
}

#[tauri::command]
pub(crate) async fn choose_external_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
    quick: bool,
) -> Result<Option<ExternalFile>, String> {
    let parent = window.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        parent
            .dialog()
            .file()
            .set_title("Ouvrir un fichier dans Black Hole")
            .set_parent(&parent)
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    if quick || image_mime(&path).is_some() {
        open_quick_file(window.app_handle(), path)?;
        Ok(None)
    } else {
        register(&state, window.label(), path).map(Some)
    }
}

#[tauri::command]
pub(crate) fn quick_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
) -> Result<ExternalFile, String> {
    state
        .pending
        .lock()
        .map_err(|error| error.to_string())?
        .remove(window.label())
        .ok_or("Aucun fichier à ouvrir.")?
}

#[tauri::command]
pub(crate) fn save_external_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
    path: PathBuf,
    content: String,
) -> Result<(), String> {
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err("Le fichier dépasse la limite de 2 Mio.".into());
    }
    let mut files = state.files.lock().map_err(|error| error.to_string())?;
    let Some(OpenedFile::Text(snapshot)) = files.get_mut(&(window.label().into(), path.clone()))
    else {
        return Err("Ouvre un fichier texte avant de le modifier.".into());
    };
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
pub(crate) async fn read_external_image(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
    path: PathBuf,
) -> Result<tauri::ipc::Response, String> {
    {
        let files = state.files.lock().map_err(|error| error.to_string())?;
        if !matches!(
            files.get(&(window.label().into(), path.clone())),
            Some(OpenedFile::Image)
        ) {
            return Err("Ouvre cette image avant de l’afficher.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        if fs::canonicalize(&path).map_err(|error| error.to_string())? != path {
            return Err("Le chemin de l’image a changé.".into());
        }
        read_bytes(&path, MAX_IMAGE_BYTES).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn forget_external_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExternalFiles>,
    path: PathBuf,
) {
    if let Ok(mut files) = state.files.lock() {
        files.remove(&(window.label().into(), path));
    }
}
