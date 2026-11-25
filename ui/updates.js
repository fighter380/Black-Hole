"use strict";

(() => {
  const { invoke } = window.__TAURI__.core;
  const el = id => document.getElementById(id);
  const badge = el("app-version");
  const dialog = el("updates-dialog");
  const status = el("updates-status");
  const notes = el("updates-remote-notes");
  const install = el("updates-install");
  const check = el("updates-check");
  const seenKey = "sbbh_last_seen_version";
  let localVersion;
  let candidate;
  let busy = false;
  let installing = false;

  const releases = [
    ["0.2.2", "Nouvelle icône", ["Le trou noir illustré devient l’icône de l’application et de l’installateur Windows."]],
    ["0.2.1", "Version et nouveautés", [
      "La version s’affiche en haut à gauche et donne accès aux mises à jour.",
      "Les nouveautés de la version installée s’affichent au premier lancement.",
      "L’installateur Windows adopte les couleurs de Second Brain et propose le français.",
    ]],
    ["0.2.0", "Atelier Arduino", [
      "Sélection du port COM, téléversement sur Arduino Uno et moniteur série intégré.",
      "Éditeur de schémas électriques avec composants, fils et sauvegarde par croquis.",
    ]],
    ["0.1.9", "Éditeur Arduino", ["Coloration C++, autocomplétion hors ligne et compilation pour Arduino Uno."]],
    ["0.1.8", "Console Python", ["Sortie et erreurs Python en direct dans l’app."]],
    ["0.1.7", "Explorateur de fichiers", ["Vues Graphe et Fichiers, dossiers dépliables et onglets d’édition."]],
    ["0.1.6", "Palette et liens", ["Boutons sombres, palette CSS hexadécimale et liens entre étoiles."]],
    ["0.1.5", "Éditeur Web", ["Renommage par double-clic, coloration et autocomplétion HTML, CSS et JavaScript hors ligne."]],
    ["0.1.4", "Projets Web", ["Création de sites et aperçu en direct. Correction du compteur de fichiers Python."]],
  ];

  for (const [number, title, changes] of releases) {
    const release = document.createElement("section");
    release.className = "lab-release";
    const heading = document.createElement("h4");
    heading.textContent = `v${number} · ${title}`;
    const list = document.createElement("ul");
    for (const change of changes) {
      const item = document.createElement("li");
      item.textContent = change;
      list.append(item);
    }
    release.append(heading, list);
    el("updates-history").append(release);
  }

  function showState(state, message) {
    badge.dataset.updateState = state;
    status.textContent = message;
    badge.setAttribute("aria-label", `Second Brain ${localVersion ?? ""}. ${message}`);
  }

  async function checkUpdates() {
    if (busy || !localVersion) return;
    busy = check.disabled = true;
    candidate = null;
    install.hidden = notes.hidden = true;
    showState("checking", "Recherche d’une mise à jour…");
    try {
      const result = await invoke("check_app_update");
      if (result.state === "available") {
        candidate = result.version;
        notes.textContent = result.notes || "";
        notes.hidden = !result.notes;
        install.hidden = false;
        showState("available", `Version ${candidate} disponible.`);
      } else if (result.state === "current") {
        showState("current", `Tu es à jour avec la version ${localVersion}.`);
      } else {
        showState("unconfigured", "Canal de mise à jour non configuré.");
      }
    } catch {
      showState("error", "Vérification impossible. Réessaie dans un instant.");
    } finally {
      busy = check.disabled = false;
    }
  }

  badge.onclick = () => { if (!dialog.open) dialog.showModal(); };
  el("updates-close").onclick = () => { if (!installing) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (installing) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    if (localVersion) localStorage.setItem(seenKey, localVersion);
  });
  check.onclick = checkUpdates;
  install.onclick = async () => {
    if (busy || !candidate) return;
    if (hasUnsavedDocuments() || fileOperation || pythonRunning || arduinoCompiling) {
      showState("available", "Enregistre tes fichiers et termine les exécutions avant l’installation.");
      return;
    }
    busy = install.disabled = check.disabled = true;
    installing = el("updates-close").disabled = true;
    showState("checking", "Téléchargement et installation en cours…");
    try {
      await invoke("install_app_update", { expectedVersion: candidate });
      status.textContent = "Mise à jour installée. Redémarre l’application.";
    } catch (error) {
      showState("error", `Installation impossible — ${error}`);
    } finally {
      busy = install.disabled = check.disabled = false;
      installing = el("updates-close").disabled = false;
    }
  };

  invoke("app_version").then(version => {
    localVersion = version;
    el("app-version-value").textContent = `v${version}`;
    if (localStorage.getItem(seenKey) !== version && !dialog.open
        && !document.querySelector('dialog[open], #lab-modal:not([hidden])')) dialog.showModal();
    checkUpdates();
  }).catch(() => showState("error", "Impossible de lire la version installée."));
})();
