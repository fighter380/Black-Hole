# Second Brain Black Hole

## Où modifier le code

| Pour modifier… | Ouvre… |
| --- | --- |
| Les boutons et la structure des écrans | [ui/index.html](ui/index.html) |
| Le thème, la disposition et la navigation générale | [ui/shell/](ui/shell/) |
| L’explorateur et le panneau Git | [ui/workspace/](ui/workspace/) |
| Le graphe et son rendu | [ui/graph/](ui/graph/) |
| Le schéma et le moniteur série | [ui/arduino/](ui/arduino/) |
| L’aperçu Web et la palette de couleurs | [ui/studio/](ui/studio/) |
| La coloration, l’autocomplétion et la simulation Arduino | [editor/](editor/) |
| Les commandes Rust pour les dossiers, les fichiers et Git | [src-tauri/src/workspace/](src-tauri/src/workspace/) |
| L’exécution Python, la compilation Arduino et le port série | [src-tauri/src/studio/](src-tauri/src/studio/) |
| La fenêtre de mises à jour et le téléchargement | [ui/release/](ui/release/) et [src-tauri/src/updates.rs](src-tauri/src/updates.rs) |
| L’installateur Windows et la publication | [src-tauri/installer/](src-tauri/installer/) et [.github/workflows/auto-release.yml](.github/workflows/auto-release.yml) |

Les fichiers de `ui/editor/` sont générés depuis `editor/`. Après une modification dans `editor/`, lance `npm run build:editor`.

## Tester sur ton PC

```powershell
npm ci
npm run build:editor
cargo tauri dev
```
