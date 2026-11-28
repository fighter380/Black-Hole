"use strict";

const { invoke } = window.__TAURI__.core;
const quickWindow = window.__TAURI__.window.getCurrentWindow();
const byId = id => document.getElementById(id);
const status = byId("status");
const saveButton = byId("save-file");
const languageNames = {
  py: "Python", js: "JavaScript", ts: "TypeScript", json: "JSON",
  html: "HTML", css: "CSS", cpp: "C++", rs: "Rust", txt: "Texte",
};
let file;
let editor;
let saved;
let lineEnding;
let bom;
let saving = false;
let closing = false;

function hasChanges() {
  return Boolean(editor && editor.value() !== saved);
}

function confirmDiscard() {
  const dialog = byId("confirm-close");
  dialog.returnValue = "";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "discard"), { once: true });
    dialog.showModal();
  });
}

async function requestClose() {
  if (saving || closing) return;
  closing = true;
  try {
    if (!hasChanges() || await confirmDiscard()) await quickWindow.destroy();
  } catch (error) {
    status.textContent = String(error);
  } finally {
    closing = false;
  }
}

async function save() {
  if (saving || !hasChanges()) return;
  saving = true;
  const text = editor.value();
  saveButton.disabled = true;
  status.textContent = "Enregistrement…";
  try {
    await invoke("save_external_file", {
      path: file.path,
      content: bom + (lineEnding === "\n" ? text : text.replaceAll("\n", lineEnding)),
    });
    saved = text;
    status.textContent = hasChanges() ? "Modifications non enregistrées" : "Enregistré";
  } catch (error) {
    status.textContent = String(error);
  } finally {
    saving = false;
    saveButton.disabled = !hasChanges();
  }
}

async function showImage() {
  const image = byId("preview-image");
  const bytes = await invoke("read_external_image", { path: file.path });
  const url = URL.createObjectURL(new Blob([bytes], { type: file.image_mime }));
  try {
    image.src = url;
    image.alt = file.name;
    await image.decode();
    image.hidden = false;
    status.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function init() {
  await quickWindow.onCloseRequested(event => {
    event.preventDefault();
    requestClose();
  });
  file = await invoke("quick_file");
  byId("file-name").textContent = file.name;
  byId("file-path").textContent = file.display_path;
  byId("file-path").title = file.display_path;
  if (file.image_mime) {
    await showImage();
    return;
  }

  const ext = file.name.match(/\.(\w+)$/)?.[1].toLowerCase();
  const language = ["ino", "c", "cc", "cxx", "h", "hpp"].includes(ext) ? "cpp"
    : ext === "htm" ? "html" : Object.hasOwn(languageNames, ext) ? ext : "txt";
  const raw = file.text;
  bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  lineEnding = raw.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  saved = raw.slice(bom.length).replace(/\r\n?/g, "\n");
  editor = StudioEditor.createCodeEditor({
    parent: byId("editor"),
    language,
    content: saved,
    getPath: () => file.name,
    onChange() {
      if (!saving) {
        saveButton.disabled = !hasChanges();
        status.textContent = hasChanges() ? "Modifications non enregistrées" : "Prêt";
      }
    },
  });
  byId("language").textContent = languageNames[language];
  saveButton.hidden = false;
  saveButton.disabled = true;
  status.textContent = "Prêt";
  editor.focus();
}

saveButton.onclick = save;
byId("close-file").onclick = requestClose;
window.addEventListener("keydown", event => {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    save();
  } else if (key === "w") {
    event.preventDefault();
    requestClose();
  }
});
init().catch(error => {
  status.textContent = error instanceof DOMException ? "Impossible d’afficher ce fichier." : String(error);
});
