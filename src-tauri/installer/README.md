# Publication des mises à jour Windows

Le canal `rolling` de [Blak-Hole](https://github.com/fighter380/Blak-Hole/releases) reçoit les installateurs et leur manifeste. Chaque build embarque les mêmes notes que le manifeste. Elles regroupent les commits de la nouvelle version et les notes des publications précédentes. L’application vérifie la signature et le numéro de version signé avant de lancer l’installation.

## Première activation

1. Dans les [secrets GitHub Actions du dépôt](https://github.com/fighter380/Blak-Hole/settings/secrets/actions), ajoute `TAURI_SIGNING_PRIVATE_KEY` avec le contenu de `%USERPROFILE%\.tauri\black-hole.key`. Ajoute `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si la clé est protégée. Conserve une sauvegarde privée de la clé et garde-la hors du dépôt et des releases.
2. Pousse le workflow et les sources sur `main`. Le workflow crée la release publique `rolling` au premier build réussi. Cette release doit rester modifiable.
3. Installe une première fois une version compatible avec ce canal depuis son installateur NSIS x64. Le premier build local compatible est 0.2.5. L’app propose ensuite les versions supérieures dans son panneau **Mises à jour**, avec téléchargement, installation silencieuse et relance depuis Black Hole.

## Publications suivantes

Un push sur `main` reconstruit l’éditeur puis l’installateur. GitHub Actions choisit une version supérieure à la version du dépôt et aux installateurs déjà déposés sur `rolling`. Le titre public de la release suit la version sous la forme **Black Hole Stable v0.2.x**. Pour une installation manuelle, le lien de la release pointe vers l’installateur Windows `.exe`. Pour une mise à jour depuis l’app, `latest.json` contient le lien vers l’installateur et sa signature. Le fichier `.sig` généré pendant le build reste dans les artefacts locaux. Les nouveautés reprennent le titre de chaque commit suivi de son SHA court, depuis le dernier build publié. Au premier build, le point de départ est le commit précédant le push, quand GitHub le fournit.

Une fois le nouveau manifeste publié, le workflow retire les anciens installateurs Windows et leurs signatures séparées de la release `rolling`. Pour rétablir le code d’une version saine, fais un commit de correction ou utilise `git revert` puis pousse sur `main`. La version du build de correction doit rester supérieure à celle déjà installée. Conserve une copie locale d’un installateur sain pour les cas où l’app ne démarre plus.

## Build local signé

Depuis la racine du dépôt, lance ces commandes. Le script utilise la clé locale par défaut. Tu peux lui passer `-KeyPath` ou définir `TAURI_SIGNING_PRIVATE_KEY` pour utiliser une autre copie de la même clé. Avec `-BaseCommit`, indique le SHA du dernier build publié. Tu peux fournir le manifeste correspondant via `-PreviousManifest` pour conserver les sections par version. Sans commit de base, les notes reprennent l’historique Git de `HEAD`.

```powershell
npm ci
npm run build:editor
pwsh -NoProfile -File ./src-tauri/installer/build-release.ps1
```

Les fichiers sont dans `src-tauri/target/github-release/v<version>`.

[Documentation Tauri sur les mises à jour signées](https://v2.tauri.app/plugin/updater/)
