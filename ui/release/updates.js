"use strict";

(() => {
  const { Channel, invoke } = window.__TAURI__.core;
  const el = id => document.getElementById(id);
  const badge = el("app-version");
  const dialog = el("updates-dialog");
  const status = el("updates-status");
  const notes = el("updates-remote-notes");
  const install = el("updates-install");
  const check = el("updates-check");
  const progress = el("updates-progress");
  const seenKey = "sbbh_last_seen_version";
  let localVersion;
  let candidate;
  let downloadedVersion;
  let busy = false;
  let installing = false;
  const startupPanelObserver = new MutationObserver(openStartupPanel);

  const versionNotes = new Map([
    ["0.2.16", ["Ouverture des fichiers texte du PC avec aperçu du code, édition et sauvegarde à leur emplacement d’origine."]],
    ["0.2.15", [
      "Défilement du moniteur série Arduino et bouton Dernières lignes.",
      "Détection de JSON, TypeScript et Rust, avec coloration et suggestions locales.",
    ]],
    ["0.2.4", ["Vérification des nouvelles versions et installation des mises à jour signées depuis GitHub Releases."]],
    ["0.2.3", ["Vérification du câblage des LED et simulation du croquis Uno compilé."]],
    ["0.2.2", ["Le trou noir illustré devient l’icône de l’application et de l’installateur Windows."]],
    ["0.2.1", [
      "La version s’affiche en haut à gauche et donne accès aux mises à jour.",
      "Les nouveautés de la version installée s’affichent au premier lancement.",
      "L’installateur Windows adopte les couleurs de Second Brain et propose le français.",
    ]],
    ["0.2.0", [
      "Sélection du port COM, téléversement sur Arduino Uno et moniteur série intégré.",
      "Éditeur de schémas électriques avec composants, fils et sauvegarde par croquis.",
    ]],
    ["0.1.9", ["Coloration C++, autocomplétion hors ligne et compilation pour Arduino Uno."]],
    ["0.1.8", ["Sortie et erreurs Python en direct dans l’app."]],
    ["0.1.7", ["Vues Graphe et Fichiers, dossiers dépliables et onglets d’édition."]],
    ["0.1.6", ["Boutons sombres, palette CSS hexadécimale et liens entre étoiles."]],
    ["0.1.5", ["Renommage par double-clic, coloration et autocomplétion HTML, CSS et JavaScript hors ligne."]],
    ["0.1.4", ["Création de sites et aperçu en direct. Correction du compteur de fichiers Python."]],
  ]);
  const publishedNotes = new Map();

  function addReleaseNotes(version, text = "") {
    let current = version;
    const releases = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^(Historique Git avant cette version|Commits antérieurs)/.test(line)) break;
      const heading = line.match(/^v(\d+\.\d+\.\d+)$/);
      if (heading) {
        current = heading[1];
      } else if (line) {
        if (!releases.has(current)) releases.set(current, []);
        releases.get(current).push(line.replace(/^-\s+/, "").replace(/\s+\([a-f0-9]{7,40}\)$/i, ""));
      }
    }
    for (const [number, changes] of releases) publishedNotes.set(number, changes);
  }

  function changesFor(version) {
    return versionNotes.get(version) ?? publishedNotes.get(version);
  }

  function renderChanges(version) {
    const list = document.createElement("ul");
    for (const change of changesFor(version) ?? ["Aucune note pour cette version."]) {
      const item = document.createElement("li");
      item.textContent = change;
      list.append(item);
    }
    return list;
  }

  function renderHistory() {
    const history = [...new Set([...versionNotes.keys(), ...publishedNotes.keys()])]
      .filter(version => version.localeCompare(localVersion, undefined, { numeric: true }) < 0)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    el("updates-history").replaceChildren(...history.map(version => {
      const release = document.createElement("section");
      release.className = "lab-release";
      const heading = document.createElement("h4");
      heading.textContent = `v${version}`;
      release.append(heading, renderChanges(version));
      return release;
    }));
    el("updates-history-section").hidden = !history.length;
  }

  function showState(state, message) {
    badge.dataset.updateState = state;
    status.textContent = message;
    badge.setAttribute("aria-label", `Second Brain ${localVersion ?? ""}. ${message}`);
  }

  function openStartupPanel() {
    if (!dialog.open && document.querySelector("dialog[open], #lab-modal:not([hidden])")) {
      for (const modal of document.querySelectorAll("dialog, #lab-modal")) {
        startupPanelObserver.observe(modal, { attributes: true, attributeFilter: ["open", "hidden"] });
      }
      return;
    }
    startupPanelObserver.disconnect();
    if (!dialog.open) dialog.showModal();
  }

  async function checkUpdates(startup = false) {
    if (busy || !localVersion) return;
    if (!navigator.onLine) {
      showState("error", "Hors ligne. La version installée reste disponible.");
      return;
    }
    busy = check.disabled = true;
    candidate = null;
    install.hidden = notes.hidden = true;
    showState("checking", "Recherche d’une mise à jour…");
    try {
      const result = await invoke("check_app_update");
      if (result.state === "available") {
        candidate = result.version;
        addReleaseNotes(candidate, result.notes ?? "");
        const heading = document.createElement("h3");
        heading.textContent = `v${candidate} · Nouveautés`;
        notes.replaceChildren(heading, renderChanges(candidate));
        notes.hidden = false;
        renderHistory();
        install.hidden = false;
        install.textContent = candidate === downloadedVersion ? "Installer et relancer" : "Installer la mise à jour";
        showState("available", `Version ${candidate} disponible.`);
        if (startup) openStartupPanel();
      } else if (result.state === "current") {
        showState("current", `Tu es à jour avec la version ${localVersion}.`);
      } else {
        showState("error", "Le manifeste de mise à jour est indisponible sur GitHub Releases.");
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
  check.onclick = () => checkUpdates();
  function readyToRestart() {
    if (ArduinoSchematic.hasUnsavedChanges) {
      showState("available", "Enregistre ton schéma Arduino avant l’installation.");
      return false;
    }
    if (!hasUnsavedDocuments() && !fileOperation && !graphLinkPending && !gitPanel.busy &&
        !BlackHoleTools.busy && !pythonRunning && !arduinoCompiling) return true;
    showState("available", "Enregistre tes fichiers et termine les exécutions avant l’installation.");
    return false;
  }

  install.onclick = async () => {
    if (busy || !candidate || !readyToRestart()) return;
    busy = install.disabled = check.disabled = true;
    installing = el("updates-close").disabled = true;
    try {
      if (downloadedVersion !== candidate) {
        showState("checking", "Téléchargement de la mise à jour…");
        progress.removeAttribute("value");
        progress.hidden = false;
        const channel = new Channel();
        channel.onmessage = ({ received, total }) => {
          if (total) progress.value = Math.min(100, (100 * received) / total);
        };
        await invoke("download_app_update", { expectedVersion: candidate, progress: channel });
        downloadedVersion = candidate;
        install.textContent = "Installer et relancer";
        progress.hidden = true;
      }
      if (!readyToRestart()) return;
      await arduinoSerial.closePort();
      if (!readyToRestart()) return;
      showState("checking", "Installation en cours. Black Hole va se relancer…");
      downloadedVersion = null;
      install.textContent = "Installer la mise à jour";
      await invoke("install_app_update", { expectedVersion: candidate });
    } catch (error) {
      showState("error", `Installation impossible — ${error}`);
    } finally {
      progress.hidden = true;
      busy = install.disabled = check.disabled = false;
      installing = el("updates-close").disabled = false;
    }
  };

  invoke("app_release_info").then(async ({ version, notes: installedNotes, windows_defaults_available }) => {
    localVersion = version;
    el("app-version-value").textContent = `v${version}`;
    addReleaseNotes(version, installedNotes ?? "");
    el("updates-installed-title").textContent = `v${version} · Nouveautés`;
    el("updates-installed-notes").replaceChildren(renderChanges(version));
    el("updates-installed").hidden = false;
    renderHistory();
    showState("unknown", `Version ${version} installée.`);
    BlackHoleDefaults.init(windows_defaults_available);
    await checkUpdates(true);
    if (localStorage.getItem(seenKey) !== version) openStartupPanel();
  }).catch(() => showState("error", "Impossible de lire la version installée."));
})();
