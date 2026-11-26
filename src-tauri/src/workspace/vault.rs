use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri_plugin_dialog::DialogExt;
use walkdir::{DirEntry, WalkDir};

#[tauri::command]
pub(crate) async fn choose_vault_folder(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_title("Ajouter un dossier à Black Hole")
            .set_parent(&window)
            .blocking_pick_folder()
            .map(|folder| {
                let path = folder.into_path().map_err(|error| error.to_string())?;
                path.into_os_string()
                    .into_string()
                    .map_err(|_| "Le chemin du dossier ne peut pas être affiché.".into())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct FileEntry {
    path: String,
    basename: String,
    ext: String,
    folder: String,
    mtime: u64,
    title: String,
    headings: Vec<String>,
    tags: Vec<String>,
    links: Vec<String>,
}

fn ensure_starter_vault(dir: &Path) {
    if dir.exists() {
        return;
    }
    let _ = fs::create_dir_all(dir.join("Tkinter"));
    let _ = fs::create_dir_all(dir.join("Python"));
    let _ = fs::create_dir_all(dir.join("Cyber"));

    let _ = fs::write(
        dir.join("Tkinter/demo_fenetre.py"),
        r##"# #tkinter #gui
# Lié à : [[cheatsheet_python]]

import tkinter as tk

def on_click():
    label.config(text="Exécuté depuis le Black Hole !")

def main():
    global label
    root = tk.Tk()
    root.title("Second Brain — Test Tkinter")
    root.geometry("380x180")
    root.configure(bg="#111114")

    label = tk.Label(root, text="Salut depuis Tkinter !", fg="#ededed", bg="#111114", font=("Sans", 13))
    label.pack(pady=30)

    btn = tk.Button(root, text="Tester le bouton", command=on_click, bg="#9a45ff", fg="white")
    btn.pack(pady=10)

    print("Fenêtre Tkinter ouverte avec succès.")
    root.mainloop()

if __name__ == "__main__":
    main()
"##,
    );

    let fence = "\x60\x60\x60";
    let cheatsheet = format!(
        "# Cheatsheet Python\n#python #notes\n\n## Bases utiles\nVoir le script graphique [[demo_fenetre]] ou [[scanner_ports]].\n\n## Snippet exécutable directement\n{fence}python\ncarres = [x**2 for x in range(1, 11)]\nprint(\"Carrés 1..10 :\", carres)\n{fence}\n"
    );
    let _ = fs::write(dir.join("Python/cheatsheet_python.md"), cheatsheet);

    let _ = fs::write(
        dir.join("Cyber/scanner_ports.py"),
        r##"# #cyber #reseau
# Voir aussi : [[cheatsheet_python]]

import socket

def check_port(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.2)
        return s.connect_ex((host, port)) == 0

def scan_localhost():
    ports = [22, 80, 443, 8000, 8080]
    print("Scan rapide de 127.0.0.1...")
    for p in ports:
        status = "OUVERT" if check_port("127.0.0.1", p) else "fermé"
        print(f"Port {p:5d} -> {status}")

if __name__ == "__main__":
    scan_localhost()
"##,
    );
}

fn parse_content_metadata(content: &str, ext: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut headings = Vec::new();
    let mut tags = Vec::new();
    let mut links = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if ext == "md" {
            if let Some(h) = trimmed
                .strip_prefix("## ")
                .or_else(|| trimmed.strip_prefix("### "))
            {
                let clean = h.trim();
                if !clean.is_empty() {
                    headings.push(clean.chars().take(120).collect());
                }
            }
        } else if ext == "py" {
            if let Some(rest) = trimmed
                .strip_prefix("def ")
                .or_else(|| trimmed.strip_prefix("async def "))
            {
                if let Some(name) = rest.split('(').next() {
                    headings.push(format!("def {}()", name.trim()));
                }
            } else if let Some(rest) = trimmed.strip_prefix("class ") {
                if let Some(name) = rest.split(|c| c == '(' || c == ':').next() {
                    headings.push(format!("class {}", name.trim()));
                }
            }
        }

        let mut cursor = trimmed;
        while let Some(start) = cursor.find("[[") {
            let after = &cursor[start + 2..];
            if let Some(end) = after.find("]]") {
                let raw = after[..end].split('|').next().unwrap_or("").trim();
                if !raw.is_empty() {
                    links.push(raw.to_string());
                }
                cursor = &after[end + 2..];
            } else {
                break;
            }
        }

        for word in trimmed.split_whitespace() {
            if word.starts_with('#') && word.len() > 1 && !word.starts_with("##") {
                let clean: String = word[1..]
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                    .collect();
                if !clean.is_empty() {
                    tags.push(clean.to_lowercase());
                }
            }
        }
    }

    tags.sort();
    tags.dedup();
    links.sort();
    links.dedup();

    (headings, tags, links)
}

#[tauri::command]
pub(crate) fn get_default_vault() -> String {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let vault = base.join("SecondBrainLab");
    ensure_starter_vault(&vault);
    vault.to_string_lossy().to_string()
}

const EDITABLE_EXTENSIONS: &[&str] = &[
    "md", "py", "lua", "sh", "js", "ts", "rs", "txt", "html", "htm", "css", "ino", "cpp", "h",
    "hpp", "c",
];
const GRAPH_LINKS_FILE: &str = ".sbbh-links.json";
#[derive(Clone, Default, Serialize, serde::Deserialize)]
pub(crate) struct GraphLinks {
    manual: Vec<[String; 2]>,
    hidden: Vec<[String; 2]>,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum StoredGraphLinks {
    Current(GraphLinks),
    Legacy(Vec<[String; 2]>),
}
static GRAPH_LINKS_LOCK: Mutex<()> = Mutex::new(());

fn vault_entries(root: &Path) -> impl Iterator<Item = DirEntry> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !name.starts_with('.')
                && !matches!(
                    name.as_ref(),
                    "__pycache__" | "node_modules" | "venv" | "target"
                )
        })
        .filter_map(Result::ok)
}

fn vault_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/"))
}

#[tauri::command]
pub(crate) fn scan_vault(vault_path: String) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&vault_path);
    if !root.exists() {
        return Err(format!("Dossier introuvable : {}", vault_path));
    }

    let mut entries = Vec::new();

    for entry in vault_entries(&root) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !EDITABLE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let rel = vault_relative_path(&root, path)?;

        let basename = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&rel)
            .to_string();

        let folder = rel
            .split('/')
            .next()
            .filter(|_| rel.contains('/'))
            .unwrap_or("Racine")
            .to_string();

        let mtime = fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let content = fs::read_to_string(path).unwrap_or_default();
        let (headings, tags, links) = parse_content_metadata(&content, &ext);
        let title = match ext.as_str() {
            "py" | "html" | "htm" | "css" | "js" | "ino" | "cpp" | "h" | "hpp" | "c" => {
                format!("{basename}.{ext}")
            }
            _ => basename.clone(),
        };

        entries.push(FileEntry {
            path: rel,
            basename,
            ext,
            folder,
            mtime,
            title,
            headings,
            tags,
            links,
        });
    }

    Ok(entries)
}

#[tauri::command]
pub(crate) fn list_vault_folders(vault_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&vault_path);
    if !root.is_dir() {
        return Err(format!("Dossier introuvable : {vault_path}"));
    }

    let mut folders = vault_entries(root)
        .filter(|entry| entry.depth() > 0 && entry.file_type().is_dir())
        .map(|entry| vault_relative_path(root, entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    folders.sort();
    Ok(folders)
}

pub(crate) fn vault_file(vault_path: &str, rel_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel_path);
    if rel_path.is_empty()
        || rel_path.contains(':')
        || !rel
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("Utilise un chemin relatif à l’intérieur du dossier.".into());
    }

    let root = fs::canonicalize(vault_path).map_err(|e| e.to_string())?;
    let full = root.join(rel);
    // Check the closest existing ancestor so new paths cannot follow a junction out of the vault.
    for path in full.ancestors() {
        match fs::canonicalize(path) {
            Ok(resolved) if resolved.starts_with(&root) => return Ok(full),
            Ok(_) => return Err("Ce chemin pointe en dehors du dossier.".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if fs::symlink_metadata(path).is_ok() {
                    return Err(error.to_string());
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Dossier introuvable.".into())
}

#[tauri::command]
pub(crate) fn read_web_files(
    vault_path: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    paths
        .iter()
        .map(|path| {
            read_file(vault_path.clone(), path.clone()).map_err(|e| format!("{path} — {e}"))
        })
        .collect()
}

#[tauri::command]
pub(crate) fn read_file(vault_path: String, rel_path: String) -> Result<String, String> {
    let full = vault_file(&vault_path, &rel_path)?;
    fs::read_to_string(full).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn save_file(
    vault_path: String,
    rel_path: String,
    content: String,
    create_only: Option<bool>,
) -> Result<(), String> {
    let full = vault_file(&vault_path, &rel_path)?;
    if create_only.unwrap_or(false) {
        let ext = full.extension().and_then(|ext| ext.to_str()).unwrap_or("");
        if !EDITABLE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
            return Err(
                "Choisis une extension prise en charge, par exemple .py, .md, .html, .css ou .js."
                    .into(),
            );
        }
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if create_only.unwrap_or(false) {
        return write_new_file(&full, &content).map_err(|e| e.to_string());
    }
    fs::write(full, content).map_err(|e| e.to_string())
}

pub(crate) fn write_new_file(path: &Path, content: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn create_web_project(vault_path: String, name: String) -> Result<String, String> {
    if name.is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return Err("Choisis un nom de dossier valide pour ton site.".into());
    }

    let project = format!("Sites/{name}");
    let dir = vault_file(&vault_path, &project)?;
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::create_dir(&dir).map_err(|e| format!("Impossible de créer {project} — {e}"))?;

    let starter = [
        ("index.html", include_str!("web-starter/index.html")),
        ("style.css", include_str!("web-starter/style.css")),
        ("script.js", include_str!("web-starter/script.js")),
    ];
    let mut created = Vec::new();
    for (filename, content) in starter {
        let path = dir.join(filename);
        if let Err(error) = write_new_file(&path, content) {
            for path in created {
                let _ = fs::remove_file(path);
            }
            let _ = fs::remove_dir(&dir);
            return Err(format!("Impossible de créer {filename} — {error}"));
        }
        created.push(path);
    }
    Ok(format!("{project}/index.html"))
}

#[tauri::command]
pub(crate) fn delete_file(vault_path: String, rel_path: String) -> Result<(), String> {
    let _lock = GRAPH_LINKS_LOCK.lock().map_err(|e| e.to_string())?;
    let full = vault_file(&vault_path, &rel_path)?;
    if full.exists() {
        let links = read_graph_links(&vault_path)?;
        let mut remaining = links.clone();
        remaining.manual.retain(|pair| !pair.contains(&rel_path));
        remaining.hidden.retain(|pair| !pair.contains(&rel_path));
        let changed = remaining.manual.len() != links.manual.len()
            || remaining.hidden.len() != links.hidden.len();
        if changed {
            write_graph_links(&vault_path, &remaining)?;
        }
        if let Err(error) = fs::remove_file(full) {
            if changed {
                write_graph_links(&vault_path, &links)?;
            }
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn read_graph_links(vault_path: &str) -> Result<GraphLinks, String> {
    let path = vault_file(vault_path, GRAPH_LINKS_FILE)?;
    match fs::read_to_string(path) {
        Ok(json) => {
            match serde_json::from_str(&json).map_err(|e| format!("Liens de la carte — {e}"))? {
                StoredGraphLinks::Current(links) => Ok(links),
                StoredGraphLinks::Legacy(manual) => Ok(GraphLinks {
                    manual,
                    hidden: Vec::new(),
                }),
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(GraphLinks::default()),
        Err(error) => Err(format!("Liens de la carte — {error}")),
    }
}

fn write_graph_links(vault_path: &str, links: &GraphLinks) -> Result<(), String> {
    let path = vault_file(vault_path, GRAPH_LINKS_FILE)?;
    let json = serde_json::to_string_pretty(links).map_err(|e| e.to_string())?;
    replace_file_atomically(&path, &json).map_err(|e| format!("Liens de la carte — {e}"))
}

pub(crate) fn replace_file_atomically(path: &Path, text: &str) -> io::Result<()> {
    static TEMP_ID: AtomicU64 = AtomicU64::new(0);
    let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let temp = path.with_file_name(format!(".sbbh-write-{}-{id}.tmp", std::process::id()));
    write_new_file(&temp, text)?;
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_graph_links(vault_path: String) -> Result<GraphLinks, String> {
    let _lock = GRAPH_LINKS_LOCK.lock().map_err(|e| e.to_string())?;
    read_graph_links(&vault_path)
}

#[tauri::command]
pub(crate) fn set_graph_link(
    vault_path: String,
    source: String,
    target: String,
    linked: bool,
) -> Result<GraphLinks, String> {
    let _lock = GRAPH_LINKS_LOCK.lock().map_err(|e| e.to_string())?;
    let first = vault_file(&vault_path, &source)?;
    let second = vault_file(&vault_path, &target)?;
    if source == target || !first.is_file() || !second.is_file() {
        return Err("Choisis deux fichiers différents du dossier.".into());
    }

    let mut pair = [source, target];
    pair.sort();
    let mut links = read_graph_links(&vault_path)?;
    let (visible, removed) = if linked {
        (&mut links.manual, &mut links.hidden)
    } else {
        (&mut links.hidden, &mut links.manual)
    };
    let count = removed.len();
    removed.retain(|link| link != &pair);
    let mut changed = count != removed.len();
    if !visible.contains(&pair) {
        visible.push(pair);
        changed = true;
    }
    if changed {
        write_graph_links(&vault_path, &links)?;
    }
    Ok(links)
}

#[tauri::command]
pub(crate) fn rename_file(
    vault_path: String,
    rel_path: String,
    new_stem: String,
) -> Result<String, String> {
    if new_stem.is_empty()
        || new_stem.starts_with('.')
        || new_stem.ends_with(['.', ' '])
        || new_stem
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return Err("Choisis un nom de fichier valide.".into());
    }

    let rel = Path::new(&rel_path);
    let ext = rel
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or("Extension introuvable.")?;
    let new_rel = rel.with_file_name(format!("{new_stem}.{ext}"));
    let new_path = new_rel.to_string_lossy().replace('\\', "/");
    let source = vault_file(&vault_path, &rel_path)?;
    let destination = vault_file(&vault_path, &new_path)?;
    if !fs::symlink_metadata(&source)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("Ce chemin ne désigne pas un fichier.".into());
    }
    if rel_path != new_path {
        let _lock = GRAPH_LINKS_LOCK.lock().map_err(|e| e.to_string())?;
        let mut links = read_graph_links(&vault_path)?;
        let mut changed = false;
        for pairs in [&mut links.manual, &mut links.hidden] {
            for pair in pairs.iter_mut() {
                for endpoint in pair.iter_mut() {
                    if *endpoint == rel_path {
                        *endpoint = new_path.clone();
                        changed = true;
                    }
                }
                pair.sort();
            }
            pairs.retain(|pair| pair[0] != pair[1]);
            pairs.sort();
            pairs.dedup();
        }
        rename_without_replacing(&source, &destination).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                "Un fichier porte déjà ce nom.".into()
            } else {
                format!("Impossible de renommer le fichier — {error}")
            }
        })?;
        if changed {
            if let Err(error) = write_graph_links(&vault_path, &links) {
                return match rename_without_replacing(&destination, &source) {
                    Ok(()) => Err(error),
                    Err(rollback) => Err(format!(
                        "{error} — restauration du nom impossible : {rollback}"
                    )),
                };
            }
        }
    }
    Ok(new_path)
}

#[cfg(windows)]
fn rename_without_replacing(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let source: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let destination: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    // The terminating zeros keep both buffers valid for the call. Zero flags forbid replacement.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn rename_without_replacing(source: &Path, destination: &Path) -> io::Result<()> {
    fs::hard_link(source, destination)?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(())
}
