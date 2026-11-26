"use strict";

(() => {
  const order = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
  const noFolders = [];

  function createBranch() {
    return { folders: new Map(), files: [] };
  }

  function organizeFiles(files, folderPaths) {
    const root = createBranch();
    function branchFor(segments) {
      let branch = root;
      for (const name of segments) {
        if (!branch.folders.has(name)) branch.folders.set(name, createBranch());
        branch = branch.folders.get(name);
      }
      return branch;
    }

    for (const path of folderPaths) branchFor(path.split("/"));
    for (const file of files) {
      const segments = file.path.split("/");
      const name = segments.pop();
      branchFor(segments).files.push({ name, file });
    }
    return root;
  }

  function create({ host, onOpen }) {
    const doc = host.ownerDocument;
    const expandedByVault = new Map();
    let folders = new Map();
    let fileRows = new Map();
    let previousFiles;
    let previousFolderPaths;
    let previousVaultPath;
    let previousSelectedPath;

    function makeRow(tag, name, depth) {
      const row = doc.createElement(tag);
      row.className = "lab-tree-row";
      row.style.setProperty("--tree-depth", depth);
      const icon = doc.createElement("span");
      icon.className = "lab-tree-icon";
      icon.setAttribute("aria-hidden", "true");
      const label = doc.createElement("span");
      label.className = "lab-tree-name";
      label.textContent = name;
      row.append(icon, label);
      return row;
    }

    function renderBranch(branch, target, folderPath, depth, expanded) {
      const orderedFolders = [...branch.folders].sort(([a], [b]) => order.compare(a, b));
      for (const [name, subfolders] of orderedFolders) {
        const path = folderPath + name;
        const folder = doc.createElement("details");
        folder.className = "lab-tree-folder";
        folder.open = expanded.has(path);
        const summary = makeRow("summary", name, depth);
        summary.dataset.treePath = path;
        summary.title = path;
        const children = doc.createElement("div");
        children.className = "lab-tree-children";
        renderBranch(subfolders, children, path + "/", depth + 1, expanded);
        folder.append(summary, children);
        folders.set(path, folder);
        folder.addEventListener("toggle", () => {
          if (folders.get(path) !== folder) return;
          if (folder.open) expanded.add(path);
          else expanded.delete(path);
        });
        target.append(folder);
      }

      branch.files.sort((a, b) => order.compare(a.name, b.name));
      for (const { name, file } of branch.files) {
        const row = makeRow("button", name, depth);
        row.type = "button";
        row.classList.add("lab-tree-file");
        row.dataset.treePath = file.path;
        row.title = file.path;
        if (file.ext) {
          const kind = doc.createElement("span");
          kind.className = "lab-tree-kind";
          kind.setAttribute("aria-hidden", "true");
          kind.textContent = file.ext.toUpperCase();
          row.append(kind);
        }
        row.addEventListener("click", () => onOpen(file));
        fileRows.set(file.path, row);
        target.append(row);
      }
    }

    function update(files, { vaultPath, selectedPath, folders: folderPaths = noFolders }) {
      const vaultChanged = vaultPath !== previousVaultPath;
      const shouldRender = vaultChanged || files !== previousFiles || folderPaths !== previousFolderPaths;
      if (!shouldRender && selectedPath === previousSelectedPath) return;

      if (!expandedByVault.has(vaultPath)) expandedByVault.set(vaultPath, new Set());
      const expanded = expandedByVault.get(vaultPath);
      if (shouldRender && previousFiles) {
        // A native toggle event can be queued when a rescan replaces the tree.
        const previousExpanded = expandedByVault.get(previousVaultPath);
        for (const [path, folder] of folders) {
          if (folder.open) previousExpanded.add(path);
          else previousExpanded.delete(path);
        }
      }

      if (selectedPath && (vaultChanged || selectedPath !== previousSelectedPath)) {
        const parts = selectedPath.split("/");
        parts.pop();
        for (let length = 1; length <= parts.length; length++) {
          const path = parts.slice(0, length).join("/");
          expanded.add(path);
          if (!vaultChanged && folders.has(path)) folders.get(path).open = true;
        }
      }

      if (shouldRender) {
        const focusedPath = host.contains(doc.activeElement) ? doc.activeElement.dataset.treePath : null;
        folders = new Map();
        fileRows = new Map();
        const next = doc.createDocumentFragment();
        if (files.length || folderPaths.length) {
          renderBranch(organizeFiles(files, folderPaths), next, "", 0, expanded);
        } else {
          const empty = doc.createElement("p");
          empty.className = "lab-tree-empty";
          empty.textContent = "Aucun fichier dans ce dossier.";
          next.append(empty);
        }
        host.replaceChildren(next);
        if (focusedPath && !vaultChanged) {
          const row = fileRows.get(focusedPath) ?? folders.get(focusedPath)?.firstElementChild;
          row?.focus({ preventScroll: true });
        }
      }

      fileRows.get(previousSelectedPath)?.removeAttribute("aria-current");
      fileRows.get(selectedPath)?.setAttribute("aria-current", "true");
      previousFiles = files;
      previousFolderPaths = folderPaths;
      previousVaultPath = vaultPath;
      previousSelectedPath = selectedPath;
    }

    return { update };
  }

  window.VaultExplorer = { create };
})();
