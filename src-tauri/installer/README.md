# Publication des mises à jour

La compilation ordinaire produit un installateur manuel. Pour une distribution avec mises à jour, configure `SBBH_UPDATE_ENDPOINT` avec l’URL HTTPS du manifeste et `SBBH_UPDATE_PUBKEY` avec le contenu de la clé publique Tauri, avant de compiler. Conserve la clé privée en lieu sûr et fournis-la au processus de signature avec `TAURI_SIGNING_PRIVATE_KEY`. Fournis `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si la clé est protégée.

```powershell
cargo tauri build --bundles nsis --config src-tauri/installer/updates.json
```

Renseigne également la clé publique dans `plugins.updater.pubkey` de la configuration Tauri pour la compilation signée. Publie l’installateur signé et le manifeste `latest.json`. Le manifeste doit contenir la nouvelle version et, pour `windows-x86_64`, l’URL de l’installateur et le contenu de sa signature `.sig`. Installe manuellement la première version compilée avec l’URL et la clé publique avant de vérifier le passage vers une version ultérieure.

[Documentation Tauri](https://v2.tauri.app/plugin/updater/)
