use super::command_without_console;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};
use std::process::{Output, Stdio};

#[derive(Default, Serialize)]
pub struct GitStatus {
    repository: Option<String>,
    prefix: String,
    branch: String,
    upstream: String,
    ahead: usize,
    behind: usize,
    detached: bool,
    changes: Vec<Change>,
}

#[derive(Serialize)]
struct Change {
    path: String,
    original: Option<String>,
    index: char,
    worktree: char,
    conflict: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GitAction {
    Stage { paths: Vec<String> },
    Unstage { paths: Vec<String> },
    Commit { message: String },
    Push,
}

fn git(folder: &str, args: &[&str]) -> Result<Output, String> {
    let mut command = command_without_console("git");
    command
        .env_remove("GIT_DIR")
        .env_remove("GIT_COMMON_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .args(["--literal-pathspecs", "-C", folder])
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "Git est introuvable. Installe Git et rends-le accessible dans le PATH.".into()
            } else {
                error.to_string()
            }
        })
}

fn checked(output: Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = [stderr.trim(), stdout.trim()].join("\n");
        Err(if message.trim().is_empty() {
            format!("Git a quitté avec le statut {}.", output.status)
        } else {
            message.trim().to_owned()
        })
    }
}

fn repository(folder: &str) -> Result<Option<String>, String> {
    let output = git(folder, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success()
        && String::from_utf8_lossy(&output.stderr).contains("not a git repository")
    {
        return Ok(None);
    }
    checked(output).map(|root| Some(root.trim_end_matches(['\r', '\n']).to_owned()))
}

fn status(folder: &str) -> Result<GitStatus, String> {
    let Some(root) = repository(folder)? else {
        return Ok(GitStatus::default());
    };
    let prefix = checked(git(folder, &["rev-parse", "--show-prefix"])?)?;
    let output = checked(git(
        &root,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "-uall",
        ],
    )?)?;
    let mut status = GitStatus {
        repository: Some(root),
        prefix: prefix.trim_end_matches(['\r', '\n']).to_owned(),
        ..GitStatus::default()
    };
    let mut records = output.split('\0').filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("# ") {
            if let Some(branch) = header.strip_prefix("branch.head ") {
                status.detached = branch == "(detached)";
                status.branch = branch.to_owned();
            } else if let Some(upstream) = header.strip_prefix("branch.upstream ") {
                status.upstream = upstream.to_owned();
            } else if let Some((ahead, behind)) = header
                .strip_prefix("branch.ab +")
                .and_then(|counts| counts.split_once(" -"))
            {
                status.ahead = ahead.parse().unwrap_or(0);
                status.behind = behind.parse().unwrap_or(0);
            }
            continue;
        }

        let Some((kind, data)) = record.split_once(' ') else {
            continue;
        };
        if kind == "?" {
            status.changes.push(Change {
                path: data.to_owned(),
                original: None,
                index: '.',
                worktree: '?',
                conflict: false,
            });
            continue;
        }
        let fields = match kind {
            "1" => 8,
            "2" => 9,
            "u" => 10,
            _ => continue,
        };
        let mut parts = data.splitn(fields, ' ');
        let mut xy = parts.next().unwrap_or_default().chars();
        let original = if kind == "2" {
            records.next().map(str::to_owned)
        } else {
            None
        };
        if let Some(path) = parts.nth(fields - 2) {
            status.changes.push(Change {
                path: path.to_owned(),
                original,
                index: xy.next().unwrap_or('.'),
                worktree: xy.next().unwrap_or('.'),
                conflict: kind == "u",
            });
        }
    }
    Ok(status)
}

fn path_args(paths: &[String]) -> Result<Vec<&str>, String> {
    if paths.is_empty()
        || paths.iter().any(|path| {
            path.is_empty()
                || path.contains(':')
                || path.contains('\\')
                || !Path::new(path)
                    .components()
                    .all(|part| matches!(part, Component::Normal(_)))
        })
    {
        return Err("Chemin Git invalide.".into());
    }
    Ok(paths.iter().map(String::as_str).collect())
}

fn apply(folder: &str, action: GitAction) -> Result<(), String> {
    let root = repository(folder)?.ok_or("Ce dossier ne fait pas partie d’un dépôt Git.")?;
    let output = match action {
        GitAction::Stage { paths } => {
            let mut args = vec!["add", "-A", "--"];
            args.extend(path_args(&paths)?);
            git(&root, &args)?
        }
        GitAction::Unstage { paths } => {
            let mut args = if git(&root, &["rev-parse", "--verify", "--quiet", "HEAD"])?
                .status
                .success()
            {
                vec!["restore", "--staged", "--"]
            } else {
                vec!["rm", "--cached", "-r", "--force", "--"]
            };
            args.extend(path_args(&paths)?);
            git(&root, &args)?
        }
        GitAction::Commit { message } => {
            let message = message.trim();
            if message.is_empty() {
                return Err("Écris un message de commit.".into());
            }
            git(&root, &["commit", "-m", message])?
        }
        GitAction::Push => {
            let head = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
            if !head.status.success() {
                return Err("Sélectionne une branche avant de pousser.".into());
            }
            let branch = checked(head)?;
            let branch = branch.trim_end_matches(['\r', '\n']);
            let remote = git(
                &root,
                &["config", "--get", &format!("branch.{branch}.remote")],
            )?;
            if remote.status.success() {
                let remote = checked(remote)?;
                let target = checked(git(
                    &root,
                    &["config", "--get", &format!("branch.{branch}.merge")],
                )?)?;
                let target = target.trim_end_matches(['\r', '\n']);
                if !target.starts_with("refs/heads/") || target.contains('\n') {
                    return Err("La branche amont n’est pas une branche Git distante.".into());
                }
                git(
                    &root,
                    &[
                        "push",
                        "--porcelain",
                        "--",
                        remote.trim_end_matches(['\r', '\n']),
                        &format!("HEAD:{target}"),
                    ],
                )?
            } else {
                git(
                    &root,
                    &[
                        "push",
                        "--porcelain",
                        "--set-upstream",
                        "--",
                        "origin",
                        "HEAD",
                    ],
                )?
            }
        }
    };
    checked(output).map(|_| ())
}

#[tauri::command]
pub async fn git_status(folder: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&folder))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn git_apply(folder: String, action: GitAction) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || apply(&folder, action))
        .await
        .map_err(|error| error.to_string())?
}
