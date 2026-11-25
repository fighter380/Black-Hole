use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct DownloadedUpdate(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Serialize)]
pub struct InstalledRelease {
    version: String,
    notes: Option<&'static str>,
}

#[derive(Serialize)]
pub struct DownloadProgress {
    received: usize,
    total: Option<u64>,
}

#[derive(Serialize)]
pub struct ReleaseCheck {
    state: &'static str,
    version: Option<String>,
    notes: Option<String>,
}

async fn latest(app: &tauri::AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    app.updater_builder()
        .timeout(Duration::from_secs(15))
        .build()?
        .check()
        .await
}

#[tauri::command]
pub fn app_release_info(app: tauri::AppHandle) -> InstalledRelease {
    InstalledRelease {
        version: app.package_info().version.to_string(),
        notes: option_env!("SBBH_RELEASE_NOTES").filter(|notes| !notes.trim().is_empty()),
    }
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<ReleaseCheck, String> {
    let (state, version, notes) = match latest(&app).await {
        Ok(None) => ("current", None, None),
        Ok(Some(update)) => (
            "available",
            Some(update.version.clone()),
            update.body.clone(),
        ),
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => ("unavailable", None, None),
        Err(error) => return Err(error.to_string()),
    };
    Ok(ReleaseCheck {
        state,
        version,
        notes,
    })
}

#[tauri::command]
pub async fn download_app_update(
    app: tauri::AppHandle,
    downloaded: tauri::State<'_, DownloadedUpdate>,
    expected_version: String,
    progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let mut update = latest(&app)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Aucune mise à jour disponible.")?;
    if update.version != expected_version {
        return Err("La version disponible a changé. Relance la vérification.".into());
    }
    // Allow a slower installer download than the manifest check.
    update.timeout = Some(Duration::from_secs(300));
    let mut received = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk;
                let _ = progress.send(DownloadProgress { received, total });
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    *downloaded.0.lock().map_err(|error| error.to_string())? = Some((update, bytes));
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(
    downloaded: tauri::State<'_, DownloadedUpdate>,
    expected_version: String,
) -> Result<(), String> {
    let (update, bytes) = downloaded
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .filter(|(update, _)| update.version == expected_version)
        .ok_or("Télécharge de nouveau la mise à jour.")?;
    update.install(bytes).map_err(|error| error.to_string())
}
