"use strict";

window.createGitPanel = function createGitPanel(openChangedFile, canRun) {
  const { invoke } = window.__TAURI__.core;
  const el = id => document.getElementById(id);
  const panel = el("git-panel");
  const refreshButton = el("git-refresh");
  const branch = el("git-branch");
  const repository = el("git-repository");
  const notice = el("git-status");
  const controls = el("git-controls");
  const commit = el("git-commit");
  const push = el("git-push");
  const message = el("git-message");
  const changes = el("git-changes");
  const labels = { A: "Ajouté", M: "Modifié", D: "Supprimé", R: "Renommé",
    C: "Copié", T: "Type modifié", "?": "Non suivi", U: "En conflit" };
  let folder;
  let request = 0;
  let snapshot;
  let pending = false;
  let loading = false;
  let refreshTimer;

  function showStatus(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle("has-error", error);
  }

  function syncControls() {
    const busy = pending || loading;
    refreshButton.disabled = busy;
    message.disabled = pending;
    commit.disabled = busy || !message.value.trim() ||
      !snapshot?.changes.some(file => !file.conflict && file.index !== ".") ||
      snapshot.changes.some(file => file.conflict);
    push.disabled = busy || !snapshot?.repository || snapshot.detached;
    for (const button of changes.querySelectorAll(".lab-git-file-action")) button.disabled = busy;
  }

  function group(title, files, staged) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = `${title} · ${files.length}`;
    section.append(heading);
    const list = document.createElement("ul");
    for (const file of files) {
      const row = document.createElement("li");
      const code = file.conflict ? "U" : staged ? file.index : file.worktree;
      const marker = document.createElement("span");
      marker.className = "lab-git-marker";
      marker.dataset.status = code;
      marker.title = labels[code] || code;
      marker.textContent = code;
      const name = document.createElement("button");
      name.type = "button";
      name.className = "lab-git-path";
      name.title = file.original ? `${file.original} → ${file.path}` : file.path;
      name.textContent = file.path;
      name.onclick = () => {
        if (!openChangedFile(file.path, snapshot.prefix)) {
          showStatus("Ce fichier ne peut pas être ouvert dans le dossier actif.");
        }
      };
      const action = document.createElement("button");
      action.type = "button";
      action.className = "lab-btn lab-git-file-action";
      const label = staged ? "Retirer de l’index" : "Indexer";
      action.title = label;
      action.setAttribute("aria-label", `${label} ${file.path}`);
      action.textContent = staged ? "−" : "+";
      action.onclick = () => {
        const paths = code === "R" && file.original ? [file.original, file.path] : [file.path];
        run({ type: staged ? "unstage" : "stage", paths }, staged ? "Fichier retiré de l’index." : "Fichier indexé.");
      };
      row.append(marker, name, action);
      list.append(row);
    }
    section.append(list);
    return section;
  }

  function render() {
    controls.hidden = !snapshot?.repository;
    branch.textContent = snapshot?.detached ? "HEAD détachée" : snapshot?.branch || "Git";
    repository.textContent = snapshot?.repository || "";
    repository.title = [repository.textContent, snapshot?.upstream].filter(Boolean).join("\n");
    if (snapshot?.upstream && (snapshot.ahead || snapshot.behind)) {
      branch.textContent += ` ↑${snapshot.ahead} ↓${snapshot.behind}`;
    }
    changes.replaceChildren();
    if (snapshot?.repository) {
      const staged = snapshot.changes.filter(file => !file.conflict && file.index !== ".");
      const modified = snapshot.changes.filter(file => file.conflict || file.worktree !== ".");
      changes.append(group("Modifications indexées", staged, true), group("Modifications", modified, false));
    }
    syncControls();
  }

  async function refresh() {
    if (!folder || panel.hidden || pending || loading) return;
    const id = ++request;
    loading = true;
    syncControls();
    try {
      const result = await invoke("git_status", { folder });
      if (id !== request) return;
      snapshot = result;
      if (!snapshot.repository) showStatus("Ce dossier ne fait pas partie d’un dépôt Git.");
      else if (!notice.textContent || notice.dataset.fromRefresh) {
        showStatus(snapshot.changes.length ? "" : "Aucun changement.");
      }
      notice.dataset.fromRefresh = "true";
    } catch (error) {
      if (id !== request) return;
      snapshot = null;
      showStatus(String(error), true);
      notice.dataset.fromRefresh = "true";
    } finally {
      if (id === request) {
        loading = false;
        render();
      }
    }
  }

  async function run(action, done) {
    if (pending || loading || !snapshot?.repository) return;
    if (!canRun()) {
      showStatus("Attends la fin de l’opération en cours.");
      return;
    }
    pending = true;
    delete notice.dataset.fromRefresh;
    showStatus(action.type === "push" ? "Envoi en cours…" : "Opération Git en cours…");
    syncControls();
    try {
      await invoke("git_apply", { folder, action });
      if (action.type === "commit") message.value = "";
      showStatus(done);
    } catch (error) {
      showStatus(String(error), true);
    } finally {
      pending = false;
      syncControls();
      await refresh();
    }
  }

  refreshButton.onclick = () => { showStatus(""); refresh(); };
  message.oninput = syncControls;
  commit.onclick = () => run({ type: "commit", message: message.value }, "Commit créé.");
  push.onclick = () => run({ type: "push" }, "Push terminé.");
  return {
    get busy() { return pending; },
    show(visible) {
      if (panel.hidden === !visible) return;
      panel.hidden = !visible;
      if (visible) refresh();
    },
    useFolder(path) {
      if (folder === path) return;
      folder = path;
      request++;
      loading = false;
      snapshot = null;
      message.value = "";
      showStatus("");
      render();
      refresh();
    },
    refreshSoon() {
      if (panel.hidden) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 200);
    },
  };
};
