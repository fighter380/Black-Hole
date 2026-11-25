use serde::Serialize;
use std::time::Duration;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Serialize)]
pub struct ReleaseCheck {
    state: &'static str,
    version: Option<String>,
    notes: Option<String>,
}

async fn latest(app: &tauri::AppHandle) -> Result<Option<Option<Update>>, String> {
    let (Some(endpoint), Some(key)) = (
        option_env!("SBBH_UPDATE_ENDPOINT"),
        option_env!("SBBH_UPDATE_PUBKEY"),
    ) else {
        return Ok(None);
    };
    if endpoint.trim().is_empty() || key.trim().is_empty() {
        return Ok(None);
    }
    let url = endpoint
        .parse::<tauri::Url>()
        .map_err(|error| error.to_string())?;
    if url.scheme() != "https" {
        return Err("Le canal de mise à jour doit utiliser HTTPS.".into());
    }
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|error| error.to_string())?
        .pubkey(key.trim())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(Some(update))
}

#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<ReleaseCheck, String> {
    let (state, version, notes) = match latest(&app).await? {
        None => ("unconfigured", None, None),
        Some(None) => ("current", None, None),
        Some(Some(update)) => (
            "available",
            Some(update.version.clone()),
            update.body.clone(),
        ),
    };
    Ok(ReleaseCheck {
        state,
        version,
        notes,
    })
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    expected_version: String,
) -> Result<(), String> {
    let update = latest(&app)
        .await?
        .flatten()
        .ok_or("Aucune mise à jour disponible.")?;
    if update.version != expected_version {
        return Err("La version disponible a changé. Relance la vérification.".into());
    }
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())
}
