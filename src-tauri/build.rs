fn main() {
    use std::{env, fs, path::PathBuf};

    println!("cargo:rerun-if-env-changed=SBBH_RELEASE_NOTES_FILE");
    let notes = if let Some(path) = env::var_os("SBBH_RELEASE_NOTES_FILE") {
        println!("cargo:rerun-if-changed={}", PathBuf::from(&path).display());
        fs::read_to_string(path).expect("Impossible de lire les notes de version")
    } else {
        String::new()
    };
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR manquant"));
    fs::write(out.join("release-notes.txt"), notes)
        .expect("Impossible de copier les notes de version");
    tauri_build::build()
}
