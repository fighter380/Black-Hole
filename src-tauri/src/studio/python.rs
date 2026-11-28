use crate::command_without_console;
use crate::workspace::vault::{vault_file, write_new_file};
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

#[derive(Default)]
pub struct RunningProcess(Arc<Mutex<Option<PythonProcess>>>);

struct PythonProcess {
    child: Child,
    stopped: bool,
}

#[derive(Serialize)]
pub struct RunResult {
    exit_code: i32,
    duration_ms: u128,
    stopped: bool,
}

#[derive(Serialize)]
pub struct PythonOutput {
    stream: &'static str,
    bytes: Vec<u8>,
}

struct TemporaryScript(PathBuf);

impl TemporaryScript {
    fn create(code: &str) -> Result<Self, String> {
        static ID: AtomicU64 = AtomicU64::new(0);
        let id = ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("sbbh-python-{}-{id}.py", std::process::id()));
        write_new_file(&path, code).map_err(|e| format!("Création du script temporaire — {e}"))?;
        Ok(Self(path))
    }
}

impl Drop for TemporaryScript {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn stream_output(
    mut pipe: impl Read,
    stream: &'static str,
    output: &Channel<PythonOutput>,
) -> io::Result<()> {
    let mut buffer = [0; 4096];
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(size) => {
                // Keep draining the pipe even if the editor has disconnected.
                let _ = output.send(PythonOutput {
                    stream,
                    bytes: buffer[..size].to_vec(),
                });
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

#[tauri::command]
pub async fn run_python(
    code: String,
    rel_path: Option<String>,
    vault_path: String,
    python_bin: Option<String>,
    output: Channel<PythonOutput>,
    state: tauri::State<'_, RunningProcess>,
) -> Result<RunResult, String> {
    let process = Arc::clone(&state.0);

    tauri::async_runtime::spawn_blocking(move || {
        let start = Instant::now();
        let temporary;
        let script = if let Some(path) = rel_path {
            vault_file(&vault_path, &path)?
        } else {
            temporary = TemporaryScript::create(&code)?;
            temporary.0.clone()
        };
        let executable = python_executable(python_bin.as_deref());

        let (stdout, stderr) = {
            let mut running = process.lock().map_err(|e| e.to_string())?;
            if running.is_some() {
                return Err("Un script Python est déjà en cours.".into());
            }
            let mut child = command_without_console(executable)
                .arg(&script)
                .current_dir(&vault_path)
                .env("PYTHONIOENCODING", "utf-8")
                .env("PYTHONUNBUFFERED", "1")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Impossible de lancer Python avec « {executable} » — {e}"))?;
            // Both handles exist because the command explicitly created pipes.
            let stdout = child.stdout.take().expect("piped stdout");
            let stderr = child.stderr.take().expect("piped stderr");
            *running = Some(PythonProcess {
                child,
                stopped: false,
            });
            (stdout, stderr)
        };

        let result = thread::scope(|threads| -> Result<_, String> {
            let stdout = threads.spawn(|| stream_output(stdout, "stdout", &output));
            let stderr = threads.spawn(|| stream_output(stderr, "stderr", &output));
            let status = loop {
                {
                    let mut running = process.lock().map_err(|e| e.to_string())?;
                    let run = running.as_mut().expect("active Python process");
                    match run.child.try_wait() {
                        Ok(Some(status)) => break Ok(status),
                        Ok(None) => {}
                        Err(error) => {
                            let _ = run.child.kill();
                            break Err(error.to_string());
                        }
                    }
                }
                thread::sleep(Duration::from_millis(25));
            };
            for reader in [stdout, stderr] {
                reader
                    .join()
                    .map_err(|_| "Lecture de la console Python interrompue.".to_owned())?
                    .map_err(|e| e.to_string())?;
            }
            status
        });
        let finished = process.lock().map_err(|e| e.to_string())?.take();
        Ok(RunResult {
            exit_code: result?.code().unwrap_or(-1),
            duration_ms: start.elapsed().as_millis(),
            stopped: finished.is_some_and(|run| run.stopped),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(super) fn python_executable(override_path: Option<&str>) -> &str {
    override_path
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(if cfg!(windows) { "python" } else { "python3" })
}

#[tauri::command]
pub fn stop_python(state: tauri::State<'_, RunningProcess>) -> Result<bool, String> {
    let mut running = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(run) = running.as_mut() {
        if run.child.try_wait().map_err(|e| e.to_string())?.is_none() {
            run.child
                .kill()
                .map_err(|e| format!("Impossible d’arrêter Python — {e}"))?;
            run.stopped = true;
            return Ok(true);
        }
    }
    Ok(false)
}
