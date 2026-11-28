use super::{arduino::find_cli, python::python_executable};
use crate::command_without_console;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::process::{Output, Stdio};
use std::sync::{Mutex, TryLockError};

static INSTALLATION: Mutex<()> = Mutex::new(());

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tool {
    ArduinoCli,
    ArduinoAvr,
    Python,
    Node,
    Rust,
}

#[derive(Serialize)]
pub struct ToolVersions {
    arduino_cli: Option<String>,
    arduino_avr: Option<String>,
    python: Option<String>,
    pip: Option<String>,
    node: Option<String>,
    rust: Option<String>,
    winget: bool,
}

fn execute(program: impl AsRef<OsStr>, args: &[&str]) -> std::io::Result<Output> {
    command_without_console(program)
        .args(args)
        .stdin(Stdio::null())
        .env("PYTHONIOENCODING", "utf-8")
        .output()
}

fn version(program: impl AsRef<OsStr>, args: &[&str]) -> Option<String> {
    let output = execute(program, args).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

fn apply(program: impl AsRef<OsStr>, args: &[&str]) -> Result<String, String> {
    let output = execute(program, args).map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let report = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if output.status.success() {
        Ok(report)
    } else {
        Err(if report.is_empty() {
            format!("L’installation a échoué ({})", output.status)
        } else {
            report
        })
    }
}

async fn install(
    job: impl FnOnce() -> Result<String, String> + Send + 'static,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = match INSTALLATION.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                return Err("Une installation est déjà en cours.".into())
            }
            Err(TryLockError::Poisoned(error)) => return Err(error.to_string()),
        };
        job()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn inspect_tools(
    cli_path: Option<String>,
    python_bin: Option<String>,
) -> Result<ToolVersions, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cli = find_cli(cli_path);
        let arduino_cli = version(&cli, &["version"]);
        let arduino_avr = arduino_cli.as_ref().and_then(|_| {
            let listed = execute(&cli, &["core", "list"]).ok()?;
            let text = String::from_utf8_lossy(&listed.stdout);
            text.lines().find_map(|line| {
                let mut fields = line.split_whitespace();
                (fields.next()? == "arduino:avr")
                    .then(|| fields.next().map(str::to_owned))
                    .flatten()
            })
        });
        let executable = python_executable(python_bin.as_deref());
        let python = version(executable, &["--version"]);
        let pip = python
            .as_ref()
            .and_then(|_| version(executable, &["-m", "pip", "--version"]));
        ToolVersions {
            arduino_cli,
            arduino_avr,
            python,
            pip,
            node: version("node", &["--version"]),
            rust: version("rustup", &["--version"]),
            winget: cfg!(windows) && version("winget", &["--version"]).is_some(),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_tool(tool: Tool, cli_path: Option<String>) -> Result<String, String> {
    install(move || {
        let id = match tool {
            Tool::ArduinoAvr => {
                let cli = find_cli(cli_path);
                apply(&cli, &["core", "update-index"])?;
                return apply(cli, &["core", "install", "arduino:avr"]);
            }
            Tool::ArduinoCli => "ArduinoSA.CLI",
            Tool::Python => "Python.Python.3.13",
            Tool::Node => "OpenJS.NodeJS.LTS",
            Tool::Rust => "Rustlang.Rustup",
        };
        if !cfg!(windows) {
            return Err("L’installation intégrée des outils utilise WinGet sous Windows.".into());
        }
        apply(
            "winget",
            &[
                "install",
                "--id",
                id,
                "--exact",
                "--source",
                "winget",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--disable-interactivity",
            ],
        )
    })
    .await
}

#[tauri::command]
pub async fn install_python_package(
    package: String,
    python_bin: Option<String>,
) -> Result<String, String> {
    let is_valid_edge = |byte: Option<u8>| byte.is_some_and(|byte| byte.is_ascii_alphanumeric());
    if package.len() > 100
        || !is_valid_edge(package.bytes().next())
        || !is_valid_edge(package.bytes().last())
        || !package
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err("Indique le nom du paquet PyPI, par exemple requests.".into());
    }
    install(move || {
        apply(
            python_executable(python_bin.as_deref()),
            &[
                "-m",
                "pip",
                "--disable-pip-version-check",
                "--no-input",
                "install",
                "--",
                &package,
            ],
        )
    })
    .await
}
