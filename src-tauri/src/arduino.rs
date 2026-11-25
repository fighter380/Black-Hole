use super::{command_without_console, replace_file_atomically, vault_file, write_new_file};
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

const UNO_FQBN: &str = "arduino:avr:uno";
const STARTER: &str = r#"const int ledPin = LED_BUILTIN;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  delay(500);
  digitalWrite(ledPin, LOW);
  delay(500);
}
"#;

#[tauri::command]
pub fn create_arduino_project(vault_path: String, name: String) -> Result<String, String> {
    if name.is_empty()
        || name.len() > 63
        || !name.starts_with(|ch: char| ch.is_ascii_alphanumeric() || ch == '_')
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        return Err(
            "Utilise jusqu’à 63 lettres sans accent, chiffres, _ ou - pour le nom du croquis."
                .into(),
        );
    }

    let relative = format!("Arduino/{name}");
    let folder = vault_file(&vault_path, &relative)?;
    if let Some(parent) = folder.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::create_dir(&folder).map_err(|error| format!("Création de {relative} — {error}"))?;
    if let Err(error) = write_new_file(&folder.join(format!("{name}.ino")), STARTER) {
        let _ = fs::remove_dir(&folder);
        return Err(format!("Création du croquis — {error}"));
    }
    Ok(format!("{relative}/{name}.ino"))
}

#[derive(Serialize)]
pub struct CompileResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    duration_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    firmware: Option<String>,
}

fn find_cli(cli_path: Option<String>) -> PathBuf {
    if let Some(path) = cli_path
        .map(|path| path.trim().to_owned())
        .filter(|path| !path.is_empty())
    {
        return path.into();
    }

    let name = if cfg!(windows) {
        "arduino-cli.exe"
    } else {
        "arduino-cli"
    };
    let search_path = env::var_os("PATH").unwrap_or_default();
    if let Some(path) = env::split_paths(&search_path)
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
    {
        return path;
    }
    if cfg!(windows) {
        for (root, install) in [
            ("ProgramFiles", "Arduino IDE"),
            ("LOCALAPPDATA", "Programs/Arduino IDE"),
        ] {
            if let Some(root) = env::var_os(root) {
                let path = PathBuf::from(root)
                    .join(install)
                    .join("resources/app/lib/backend/resources")
                    .join(name);
                if path.is_file() {
                    return path;
                }
            }
        }
    }
    name.into()
}

fn sketch_folder(vault: &str, sketch: &str) -> Result<PathBuf, String> {
    let folder = if sketch.is_empty() {
        fs::canonicalize(vault).map_err(|error| error.to_string())?
    } else {
        vault_file(vault, sketch)?
    };
    let name = folder
        .file_name()
        .and_then(|part| part.to_str())
        .ok_or("Nom de croquis introuvable.")?;
    let entry = Path::new(sketch).join(format!("{name}.ino"));
    if !vault_file(vault, &entry.to_string_lossy())?.is_file() {
        return Err(format!("Fichier principal introuvable : {name}.ino."));
    }
    Ok(folder)
}

fn run_cli(mut command: Command) -> Result<CompileResult, String> {
    let start = Instant::now();
    let output = command.stdin(Stdio::null()).output().map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "Arduino CLI est introuvable. Installe-le ou renseigne son chemin avec « CLI Arduino »."
                .to_owned()
        } else {
            format!("Impossible de démarrer Arduino CLI — {error}")
        }
    })?;
    let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if stderr.contains("platform not installed")
        || stderr.contains("Platform 'arduino:avr' not found")
    {
        stderr.push_str("\nInstalle le cœur Arduino AVR Boards ou lance : arduino-cli core install arduino:avr\n");
    }
    Ok(CompileResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr,
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms: start.elapsed().as_millis(),
        firmware: None,
    })
}

#[tauri::command]
pub async fn compile_arduino(
    vault_path: String,
    sketch_path: String,
    cli_path: Option<String>,
    with_firmware: Option<bool>,
) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = sketch_folder(&vault_path, &sketch_path)?;
        let temporary = with_firmware
            .unwrap_or(false)
            .then(tempfile::tempdir)
            .transpose()
            .map_err(|error| format!("Dossier temporaire de compilation indisponible — {error}"))?;
        let artifacts = match &temporary {
            Some(dir) => dir.path().to_owned(),
            None => {
                let relative = Path::new(&sketch_path).join(".build");
                vault_file(&vault_path, &relative.to_string_lossy())?
            }
        };
        let mut command = command_without_console(find_cli(cli_path));
        command
            .args(["compile", "--fqbn", UNO_FQBN, "--output-dir"])
            .arg(&artifacts)
            .arg(&folder);
        let mut result = run_cli(command)?;
        if temporary.is_some() && result.exit_code == 0 {
            let name = folder.file_name().ok_or("Nom de croquis introuvable.")?;
            let mut filename = name.to_os_string();
            filename.push(".ino.hex");
            result.firmware = Some(fs::read_to_string(artifacts.join(&filename)).map_err(
                |error| {
                    format!(
                        "Firmware {} introuvable ou illisible — {error}",
                        filename.to_string_lossy()
                    )
                },
            )?);
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn upload_arduino(
    vault_path: String,
    sketch_path: String,
    cli_path: Option<String>,
    port: String,
) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = sketch_folder(&vault_path, &sketch_path)?;
        let artifacts = Path::new(&sketch_path).join(".build");
        let artifacts = vault_file(&vault_path, &artifacts.to_string_lossy())?;
        let mut command = command_without_console(find_cli(cli_path));
        command
            .args(["upload", "--fqbn", UNO_FQBN, "--port"])
            .arg(port)
            .arg("--input-dir")
            .arg(artifacts)
            .arg(folder);
        run_cli(command)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn schematic_path(vault: &str, sketch: &str) -> Result<PathBuf, String> {
    sketch_folder(vault, sketch)?;
    let relative = Path::new(sketch).join(".sbbh-schematic.json");
    vault_file(vault, &relative.to_string_lossy())
}

#[tauri::command]
pub fn read_arduino_schematic(
    vault_path: String,
    sketch_path: String,
) -> Result<Option<Value>, String> {
    let path = schematic_path(&vault_path, &sketch_path)?;
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|error| format!("Schéma illisible — {error}")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn save_arduino_schematic(
    vault_path: String,
    sketch_path: String,
    schematic: Value,
) -> Result<(), String> {
    let path = schematic_path(&vault_path, &sketch_path)?;
    let text = serde_json::to_string_pretty(&schematic).map_err(|error| error.to_string())?;
    if text.len() > 256_000 {
        return Err("Le schéma dépasse la taille prise en charge.".into());
    }
    replace_file_atomically(&path, &text).map_err(|error| error.to_string())
}
