const { Channel, invoke } = window.__TAURI__.core;

/* ============================================================
   1. Helpers DOM attendus par main.js
   ============================================================ */
Object.defineProperties(HTMLElement.prototype, {
  doc: { get() { return this.ownerDocument; }, configurable: true },
  win: { get() { return this.ownerDocument.defaultView; }, configurable: true },
});

HTMLElement.prototype.empty = function () { this.innerHTML = ""; return this; };
HTMLElement.prototype.addClass = function (...classes) {
  for (const c of classes) {
    if (c) c.split(/\s+/).filter(Boolean).forEach((x) => this.classList.add(x));
  }
  return this;
};
HTMLElement.prototype.hide = function () { this.style.display = "none"; };
HTMLElement.prototype.show = function () { this.style.display = ""; };
HTMLElement.prototype.setCssProps = function (props) {
  for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};
HTMLElement.prototype.createEl = function (tag, opts = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (typeof opts === "string") {
    el.textContent = opts;
  } else if (opts) {
    if (opts.cls) {
      const list = Array.isArray(opts.cls) ? opts.cls : String(opts.cls).split(/\s+/);
      list.filter(Boolean).forEach((c) => el.classList.add(c));
    }
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.attr) {
      for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
    }
  }
  this.appendChild(el);
  return el;
};
HTMLElement.prototype.createDiv = function (opts) { return this.createEl("div", opts); };
HTMLElement.prototype.createSpan = function (opts) { return this.createEl("span", opts); };

/* ============================================================
   2. Coloration syntaxique + Autocomplétion 100 % hors-ligne
   ============================================================ */
const editor = document.getElementById("code-editor");
const highlightPre = document.getElementById("code-highlight");
const highlightInner = document.getElementById("code-highlight-inner");
const gutter = document.getElementById("editor-gutter");
const acPopup = document.getElementById("ac-popup");
const editorHost = document.getElementById("code-editor-host");

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PY_RE = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[a-zA-Z_]\w*)|(\b(?:def|class)\b)([ \t]+)([a-zA-Z_]\w*)|(\b(?:False|None|True|and|as|assert|async|await|break|continue|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\b)|(\b(?:print|len|range|int|float|str|bool|list|dict|set|tuple|open|input|type|isinstance|enumerate|zip|map|filter|sorted|reversed|min|max|sum|abs|round|any|all|super|self|dir|help|id|chr|ord)\b)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*(?=\s*\())/g;
const MD_RE = /(^#{1,6}[ \t][^\n]*)|(\[\[[^\]]+\]\])|(\*\*[^*\n]+\*\*)|(\x60[^\x60\n]+\x60)|((?:^|\s)#[a-zA-Z0-9_-]+)/gm;

function highlightCode(text, ext) {
  const re = ext === "md" ? MD_RE : PY_RE;
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    if (ext === "md") {
      if (m[1]) out += `<span class="tok-dec">${escapeHtml(m[1])}</span>`;
      else if (m[2]) out += `<span class="tok-link">${escapeHtml(m[2])}</span>`;
      else if (m[3]) out += `<span class="tok-kw">${escapeHtml(m[3])}</span>`;
      else if (m[4]) out += `<span class="tok-str">${escapeHtml(m[4])}</span>`;
      else if (m[5]) out += `<span class="tok-bi">${escapeHtml(m[5])}</span>`;
    } else {
      if (m[1]) out += `<span class="tok-com">${escapeHtml(m[1])}</span>`;
      else if (m[2]) out += `<span class="tok-str">${escapeHtml(m[2])}</span>`;
      else if (m[3]) out += `<span class="tok-dec">${escapeHtml(m[3])}</span>`;
      else if (m[4]) out += `<span class="tok-kw">${m[4]}</span>${m[5]}<span class="tok-fn">${escapeHtml(m[6])}</span>`;
      else if (m[7]) out += `<span class="tok-kw">${m[7]}</span>`;
      else if (m[8]) out += `<span class="tok-bi">${m[8]}</span>`;
      else if (m[9]) out += `<span class="tok-num">${m[9]}</span>`;
      else if (m[10]) out += `<span class="tok-call">${escapeHtml(m[10])}</span>`;
    }
    last = re.lastIndex;
  }

  if (last < text.length) out += escapeHtml(text.slice(last));
  return text.endsWith("\n") ? out + " " : out;
}

let lastLineCount = 0;
function renderEditorVisuals() {
  const text = editor.value;
  const ext = currentFile?.ext || "py";
  highlightInner.innerHTML = highlightCode(text, ext);

  const lines = text.split("\n").length;
  if (lines !== lastLineCount) {
    lastLineCount = lines;
    let nums = "";
    for (let i = 1; i <= lines; i++) nums += i + "\n";
    gutter.textContent = nums;
  }
  syncEditorScroll();
  trackEditorContent(text);
}

function syncEditorScroll() {
  highlightPre.scrollTop = editor.scrollTop;
  highlightPre.scrollLeft = editor.scrollLeft;
  gutter.scrollTop = editor.scrollTop;
}

editor.addEventListener("scroll", syncEditorScroll);

/* Base de données d'autocomplétion 100 % locale */
const PY_ITEMS = [
  // Snippets complets ($0 = position du curseur après insertion)
  { label: "def", insert: "def $0():\n    pass", tag: "snp", cls: "ac-snp", detail: "fonction" },
  { label: "class", insert: "class $0:\n    def __init__(self):\n        pass", tag: "snp", cls: "ac-snp", detail: "classe" },
  { label: "ifmain", insert: 'if __name__ == "__main__":\n    $0main()', tag: "snp", cls: "ac-snp", detail: "point d'entrée" },
  { label: "fori", insert: "for i in range($0):\n    ", tag: "snp", cls: "ac-snp", detail: "boucle range" },
  { label: "try", insert: "try:\n    $0\nexcept Exception as e:\n    print(e)", tag: "snp", cls: "ac-snp", detail: "try / except" },
  { label: "withopen", insert: 'with open("$0", "r", encoding="utf-8") as f:\n    data = f.read()', tag: "snp", cls: "ac-snp", detail: "lire fichier" },
  {
    label: "tkapp",
    insert: 'import tkinter as tk\n\nroot = tk.Tk()\nroot.title("$0Mon App")\nroot.geometry("420x260")\nroot.configure(bg="#111114")\n\nlabel = tk.Label(root, text="Bonjour", fg="#ededed", bg="#111114", font=("Sans", 13))\nlabel.pack(pady=20)\n\nroot.mainloop()',
    tag: "tk",
    cls: "ac-tk",
    detail: "app Tkinter complète",
  },
  { label: "tkbtn", insert: 'tk.Button(root, text="$0", command=on_click, bg="#9a45ff", fg="white").pack(pady=8)', tag: "tk", cls: "ac-tk", detail: "bouton Tkinter" },
  { label: "tklbl", insert: 'tk.Label(root, text="$0", fg="#ededed", bg="#111114").pack(pady=6)', tag: "tk", cls: "ac-tk", detail: "label Tkinter" },
  { label: "tkentry", insert: 'entry = tk.Entry(root, width=28)\nentry.pack(pady=6)$0', tag: "tk", cls: "ac-tk", detail: "champ texte" },
  { label: "tkcanvas", insert: 'canvas = tk.Canvas(root, width=400, height=300, bg="#0b0b0f", highlightthickness=0)\ncanvas.pack()$0', tag: "tk", cls: "ac-tk", detail: "canvas 2D" },

  // Tkinter widgets & modules
  { label: "tkinter", insert: "import tkinter as tk$0", tag: "tk", cls: "ac-tk", detail: "module GUI" },
  { label: "ttk", insert: "from tkinter import ttk$0", tag: "tk", cls: "ac-tk", detail: "widgets modernes" },
  { label: "messagebox", insert: "from tkinter import messagebox$0", tag: "tk", cls: "ac-tk", detail: "popup alerte" },
  { label: "filedialog", insert: "from tkinter import filedialog$0", tag: "tk", cls: "ac-tk", detail: "choisir fichier" },
  { label: "Tk", insert: "Tk()$0", tag: "tk", cls: "ac-tk", detail: "fenêtre racine", dot: true },
  { label: "Toplevel", insert: "Toplevel($0)", tag: "tk", cls: "ac-tk", detail: "fenêtre secondaire", dot: true },
  { label: "Frame", insert: "Frame($0)", tag: "tk", cls: "ac-tk", detail: "conteneur", dot: true },
  { label: "Label", insert: 'Label($0, text="")', tag: "tk", cls: "ac-tk", detail: "texte", dot: true },
  { label: "Button", insert: 'Button($0, text="", command=)', tag: "tk", cls: "ac-tk", detail: "bouton", dot: true },
  { label: "Entry", insert: "Entry($0)", tag: "tk", cls: "ac-tk", detail: "saisie texte", dot: true },
  { label: "Text", insert: "Text($0, height=10, width=40)", tag: "tk", cls: "ac-tk", detail: "zone multiligne", dot: true },
  { label: "Canvas", insert: "Canvas($0, width=400, height=300)", tag: "tk", cls: "ac-tk", detail: "dessin 2D", dot: true },
  { label: "Checkbutton", insert: 'Checkbutton($0, text="")', tag: "tk", cls: "ac-tk", detail: "case à cocher", dot: true },
  { label: "Scale", insert: 'Scale($0, from_=0, to=100, orient="horizontal")', tag: "tk", cls: "ac-tk", detail: "curseur", dot: true },
  { label: "StringVar", insert: 'StringVar(value="$0")', tag: "tk", cls: "ac-tk", detail: "var réactive", dot: true },
  { label: "IntVar", insert: "IntVar(value=$0)", tag: "tk", cls: "ac-tk", detail: "var entière", dot: true },

  // Méthodes courantes (après un ".")
  { label: "pack", insert: "pack(pady=$0)", tag: "tk", cls: "ac-tk", detail: "placement pack", dot: true },
  { label: "grid", insert: "grid(row=$0, column=0, padx=6, pady=6)", tag: "tk", cls: "ac-tk", detail: "placement grille", dot: true },
  { label: "place", insert: "place(x=$0, y=0)", tag: "tk", cls: "ac-tk", detail: "position absolue", dot: true },
  { label: "config", insert: "config($0)", tag: "tk", cls: "ac-tk", detail: "modifier widget", dot: true },
  { label: "configure", insert: "configure($0)", tag: "tk", cls: "ac-tk", detail: "modifier options", dot: true },
  { label: "title", insert: 'title("$0")', tag: "tk", cls: "ac-tk", detail: "titre fenêtre", dot: true },
  { label: "geometry", insert: 'geometry("$0400x300")', tag: "tk", cls: "ac-tk", detail: "taille fenêtre", dot: true },
  { label: "bind", insert: 'bind("<$0>", )', tag: "tk", cls: "ac-tk", detail: "événement", dot: true },
  { label: "after", insert: "after($01000, )", tag: "tk", cls: "ac-tk", detail: "timer GUI", dot: true },
  { label: "mainloop", insert: "mainloop()$0", tag: "tk", cls: "ac-tk", detail: "lancer GUI", dot: true },
  { label: "destroy", insert: "destroy()$0", tag: "tk", cls: "ac-tk", detail: "fermer widget", dot: true },
  { label: "get", insert: "get()$0", tag: "fn", cls: "ac-fn", detail: "lire valeur", dot: true },
  { label: "set", insert: "set($0)", tag: "fn", cls: "ac-fn", detail: "définir valeur", dot: true },
  { label: "append", insert: "append($0)", tag: "fn", cls: "ac-fn", detail: "ajouter à la liste", dot: true },
  { label: "split", insert: "split($0)", tag: "fn", cls: "ac-fn", detail: "découper chaîne", dot: true },
  { label: "strip", insert: "strip()$0", tag: "fn", cls: "ac-fn", detail: "retirer espaces", dot: true },
  { label: "join", insert: "join($0)", tag: "fn", cls: "ac-fn", detail: "joindre liste", dot: true },
  { label: "replace", insert: 'replace("$0", "")', tag: "fn", cls: "ac-fn", detail: "remplacer texte", dot: true },
  { label: "items", insert: "items()$0", tag: "fn", cls: "ac-fn", detail: "paires clé/valeur", dot: true },
  { label: "keys", insert: "keys()$0", tag: "fn", cls: "ac-fn", detail: "clés dict", dot: true },
  { label: "values", insert: "values()$0", tag: "fn", cls: "ac-fn", detail: "valeurs dict", dot: true },
];

for (const fn of ["print", "len", "range", "input", "int", "float", "str", "bool", "list", "dict", "set", "tuple", "open", "type", "isinstance", "enumerate", "zip", "sorted", "reversed", "min", "max", "sum", "abs", "round", "map", "filter", "any", "all"]) {
  PY_ITEMS.push({ label: fn, insert: `${fn}($0)`, tag: "fn", cls: "ac-fn", detail: "builtin" });
}
for (const kw of ["import", "from", "return", "elif", "else", "while", "break", "continue", "pass", "raise", "assert", "with", "yield", "async", "await", "lambda", "global", "True", "False", "None", "match", "case"]) {
  PY_ITEMS.push({ label: kw, insert: `${kw} $0`, tag: "kw", cls: "ac-kw", detail: "mot-clé" });
}
for (const mod of ["os", "sys", "socket", "json", "re", "math", "random", "time", "datetime", "pathlib", "subprocess", "threading", "requests", "hashlib", "base64"]) {
  PY_ITEMS.push({ label: mod, insert: `${mod}$0`, tag: "var", cls: "ac-var", detail: "module std" });
}

let acList = [];
let acIndex = 0;
let acTokenStart = 0;
let cachedCharWidth = 8.1;

function measureCharWidth() {
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;visibility:hidden;font-family:var(--font-monospace);font-size:13.5px;white-space:pre;";
  probe.textContent = "0000000000";
  document.body.appendChild(probe);
  cachedCharWidth = probe.getBoundingClientRect().width / 10 || 8.1;
  probe.remove();
}

function getLocalSymbols(code) {
  const locals = [];
  const seen = new Set();
  for (const m of code.matchAll(/^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)/gm)) {
    if (!seen.has(m[1])) { seen.add(m[1]); locals.push({ label: m[1], insert: `${m[1]}($0)`, tag: "fn", cls: "ac-fn", detail: "fonction locale" }); }
  }
  for (const m of code.matchAll(/^\s*class\s+([a-zA-Z_]\w*)/gm)) {
    if (!seen.has(m[1])) { seen.add(m[1]); locals.push({ label: m[1], insert: `${m[1]}($0)`, tag: "snp", cls: "ac-snp", detail: "classe locale" }); }
  }
  for (const m of code.matchAll(/^\s*([a-zA-Z_]\w*)\s*=/gm)) {
    if (!seen.has(m[1])) { seen.add(m[1]); locals.push({ label: m[1], insert: `${m[1]}$0`, tag: "var", cls: "ac-var", detail: "variable locale" }); }
  }
  return locals;
}

function hideAutocomplete() {
  acPopup.hidden = true;
  acList = [];
}

function positionAutocomplete(pos) {
  const before = editor.value.slice(0, pos).split("\n");
  const row = before.length - 1;
  const col = before[row].length;
  const lineH = 21;
  const hostRect = editorHost.getBoundingClientRect();

  let top = 12 + (row + 1) * lineH - editor.scrollTop + 2;
  let left = 46 + 14 + col * cachedCharWidth - editor.scrollLeft;

  if (top + 210 > hostRect.height) top = Math.max(8, top - lineH - 216);
  left = Math.max(50, Math.min(left, hostRect.width - 290));

  acPopup.style.top = top + "px";
  acPopup.style.left = left + "px";
}

function renderAutocomplete() {
  acPopup.innerHTML = "";
  acList.forEach((item, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lab-ac-item" + (idx === acIndex ? " selected" : "");
    btn.innerHTML = `<span class="lab-ac-left"><span class="lab-ac-tag ${item.cls}">${item.tag}</span><span>${escapeHtml(item.label)}</span></span><span class="lab-ac-detail">${escapeHtml(item.detail)}</span>`;
    btn.onmousedown = (e) => {
      e.preventDefault();
      applyAutocomplete(item);
    };
    acPopup.appendChild(btn);
  });
  const sel = acPopup.querySelector(".selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function applyAutocomplete(item) {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, acTokenStart);
  const after = editor.value.slice(pos);

  // Aligne l'indentation des snippets multilignes sur la ligne actuelle
  const currentLineIndent = before.split("\n").pop().match(/^\s*/)[0];
  const indented = item.insert.replace(/\n/g, "\n" + currentLineIndent);
  const markerPos = indented.indexOf("$0");
  const cleanInsert = indented.replace("$0", "");

  editor.value = before + cleanInsert + after;
  const newCaret = acTokenStart + (markerPos >= 0 ? markerPos : cleanInsert.length);
  editor.selectionStart = editor.selectionEnd = newCaret;
  hideAutocomplete();
  renderEditorVisuals();
  editor.focus();
}

function updateAutocomplete(force = false) {
  if (currentFile?.ext !== "py") { hideAutocomplete(); return; }
  const pos = editor.selectionStart;
  if (pos !== editor.selectionEnd) { hideAutocomplete(); return; }

  const before = editor.value.slice(0, pos);
  const match = before.match(/(\.?)([a-zA-Z_]\w*)$/);
  const afterDotOnly = before.endsWith(".");

  if (!match && !(afterDotOnly && (force || true))) {
    hideAutocomplete();
    return;
  }

  const isDot = afterDotOnly || (match && match[1] === ".");
  const prefix = afterDotOnly ? "" : match[2];
  if (!force && !isDot && prefix.length < 1) {
    hideAutocomplete();
    return;
  }

  acTokenStart = pos - prefix.length;
  const q = prefix.toLowerCase();
  const pool = isDot ? PY_ITEMS.filter((i) => i.dot) : [...getLocalSymbols(editor.value), ...PY_ITEMS];

  const seen = new Set();
  acList = pool
    .filter((i) => {
      if (seen.has(i.label)) return false;
      const l = i.label.toLowerCase();
      if (q && (!l.startsWith(q) || l === q)) return false;
      seen.add(i.label);
      return true;
    })
    .slice(0, 12);

  if (!acList.length) { hideAutocomplete(); return; }
  acIndex = 0;
  positionAutocomplete(pos);
  renderAutocomplete();
  acPopup.hidden = false;
}

editor.addEventListener("input", () => {
  renderEditorVisuals();
  updateAutocomplete(false);
});

editor.addEventListener("click", hideAutocomplete);

const AUTO_PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };

editor.addEventListener("keydown", (e) => {
  // Navigation dans la popup d'autocomplétion
  if (!acPopup.hidden) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      acIndex = (acIndex + 1) % acList.length;
      renderAutocomplete();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      acIndex = (acIndex - 1 + acList.length) % acList.length;
      renderAutocomplete();
      return;
    }
    if ((e.key === "Tab" || e.key === "Enter") && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      applyAutocomplete(acList[acIndex]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideAutocomplete();
      return;
    }
  }

  // Ctrl + Espace force l'autocomplétion
  if (e.ctrlKey && e.code === "Space") {
    e.preventDefault();
    updateAutocomplete(true);
    return;
  }

  // Tab / Shift+Tab
  if (e.key === "Tab") {
    e.preventDefault();
    const s = editor.selectionStart;
    const end = editor.selectionEnd;
    if (e.shiftKey) {
      const lineStart = editor.value.lastIndexOf("\n", s - 1) + 1;
      if (editor.value.slice(lineStart, lineStart + 4) === "    ") {
        editor.value = editor.value.slice(0, lineStart) + editor.value.slice(lineStart + 4);
        editor.selectionStart = editor.selectionEnd = Math.max(lineStart, s - 4);
      }
    } else {
      editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
    renderEditorVisuals();
    return;
  }

  // Auto-indentation sur Entrée (ajoute 4 espaces après ":")
  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const s = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf("\n", s - 1) + 1;
    const lineText = editor.value.slice(lineStart, s);
    const baseIndent = lineText.match(/^[ \t]*/)[0];
    const indentAfter = currentFile?.ext === "py" ? ":" : "{";
    const extra = lineText.trimEnd().endsWith(indentAfter) ? "    " : "";
    const insertion = "\n" + baseIndent + extra;
    editor.value = editor.value.slice(0, s) + insertion + editor.value.slice(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = s + insertion.length;
    renderEditorVisuals();
    return;
  }

  // Auto-fermeture des (), [], {}, "", ''
  if (AUTO_PAIRS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const s = editor.selectionStart;
    const end = editor.selectionEnd;
    if (s === end) {
      e.preventDefault();
      editor.value = editor.value.slice(0, s) + e.key + AUTO_PAIRS[e.key] + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = s + 1;
      renderEditorVisuals();
    }
  }
});

/* ============================================================
   3. État, Studio Python/Tkinter & Modes Eco RAM
   ============================================================ */
let vaultPath = localStorage.getItem("sbbh_vault_path") || "";
let filesList = [];
let vaultFolders = [];
let currentFile = null;
let fileOpenRequest = 0;
let fileOperation = false;
let pythonRunning = false;
let arduinoCompiling = false;
const ARDUINO_EXTENSIONS = new Set(["ino", "cpp", "h", "hpp", "c"]);
const openDocuments = new Map();
let workspaceView = localStorage.getItem("sbbh_workspace_view") === "files" ? "files" : "graph";
let webPagePath = null;
let previewTimer = null;
let previewRequest = 0;
let savedLabelTimer = null;
let activeView = null;
let modalCallback = null;
let userPaused3D = localStorage.getItem("sbbh_eco_paused") === "1";
let liteMode = localStorage.getItem("sbbh_lite_mode") === "1";
let graphLinkMode = false;
let graphLinkSource = null;
let graphLinkPending = false;
let graphLinkTimer;
let graphManualLinks = new Map();
let savedGraphLinks = { manual: [], hidden: [] };
let graphLinksRevision = 0;

const drawer = document.getElementById("code-drawer");
const drawerPath = document.getElementById("drawer-path");
const drawerBadge = document.getElementById("drawer-badge");
const consoleOut = document.getElementById("console-output");
const consoleStatus = document.getElementById("console-status");
const btnRun = document.getElementById("btn-run");
const btnSave = document.getElementById("btn-save");
const btnStop = document.getElementById("btn-stop");
const btnEco = document.getElementById("btn-eco");
const btnLite = document.getElementById("btn-lite");
const btnLinkStars = document.getElementById("btn-link-stars");
const linkStarsStatus = document.getElementById("link-stars-status");
const btnColor = document.getElementById("btn-color");
const btnArduinoCli = document.getElementById("btn-arduino-cli");
const btnArduinoUpload = document.getElementById("btn-arduino-upload");
const btnArduinoSchematic = document.getElementById("btn-arduino-schematic");
const arduinoSerial = ArduinoSerial.create(syncCodeActions);
const searchInput = document.getElementById("lab-search");
const searchResults = document.getElementById("lab-search-results");
const webTabs = document.getElementById("web-files");
const webPreview = document.getElementById("web-preview");
const previewStatus = document.getElementById("web-preview-status");
const previewFrame = document.getElementById("web-preview-frame");
const studioConsole = document.getElementById("studio-console");
const consoleTitle = document.getElementById("console-title");
const codeMirrorEditorHost = document.getElementById("web-editor-host");
const btnCloseDrawer = document.getElementById("btn-close-drawer");
const viewGraph = document.getElementById("view-graph");
const viewFiles = document.getElementById("view-files");
const mapRoot = document.getElementById("map-root");
const fileExplorer = document.getElementById("file-explorer");
const explorerVault = document.getElementById("explorer-vault");
const filesEmpty = document.getElementById("files-empty");
const openEditorTabs = document.getElementById("open-editor-tabs");
const explorer = VaultExplorer.create({
  host: document.getElementById("vault-tree"),
  onOpen: openFileInStudio,
});
let codeMirrorEditor = null;

function activeDocument() {
  return openDocuments.get(currentFile?.path);
}

function isDirty(doc) {
  return doc.text !== doc.saved;
}

function hasUnsavedDocuments() {
  return [...openDocuments.values()].some(isDirty);
}

function trackEditorContent(text) {
  const doc = activeDocument();
  if (!doc || text === doc.text) return;
  const wasDirty = isDirty(doc);
  doc.text = text;
  ArduinoSchematic.sourceChanged();
  if (wasDirty !== isDirty(doc)) updateTabDirtyState(doc);
}

function updateTabDirtyState(doc) {
  const tab = [...openEditorTabs.children].find(item => item.dataset.path === doc.file.path);
  if (tab) tab.classList.toggle("is-dirty", isDirty(doc));
}

function activeDraft(path) {
  const doc = openDocuments.get(path);
  return doc && isDirty(doc) ? doc.text : undefined;
}

function renderOpenTabs() {
  openEditorTabs.replaceChildren(...[...openDocuments.values()].map(doc => {
    const path = doc.file.path;
    const name = path.split("/").pop();
    const tab = document.createElement("div");
    tab.className = "lab-open-tab";
    tab.classList.toggle("is-dirty", isDirty(doc));
    tab.dataset.path = path;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "lab-open-tab-select";
    select.textContent = name;
    select.title = path;
    if (currentFile?.path === path) select.setAttribute("aria-current", "true");
    select.onclick = () => openFileInStudio(doc.file);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "lab-open-tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Fermer ${path}`);
    close.onclick = () => closeFileTab(path);
    tab.append(select, close);
    return tab;
  }));
  openEditorTabs.hidden = !openDocuments.size;
  openEditorTabs.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateExplorer() {
  explorerVault.textContent = vaultPath.split(/[\\/]+/).filter(Boolean).pop() ?? "";
  explorerVault.title = vaultPath;
  explorer.update(filesList, { vaultPath, folders: vaultFolders, selectedPath: currentFile?.path });
}

function updateWorkspaceVisibility() {
  const files = workspaceView === "files";
  document.body.classList.toggle("is-files-view", files);
  viewGraph.setAttribute("aria-pressed", String(!files));
  viewFiles.setAttribute("aria-pressed", String(files));
  mapRoot.inert = files;
  fileExplorer.hidden = !files;
  filesEmpty.hidden = !files || !drawer.hidden;
  btnCloseDrawer.textContent = files ? "Fermer" : "Masquer";
  syncMapMotion();
}

function setWorkspaceView(view) {
  if (view === workspaceView) return;
  if (graphLinkMode && !graphLinkPending) finishGraphLinkMode();
  workspaceView = view;
  localStorage.setItem("sbbh_workspace_view", view);
  if (view === "graph") {
    closeDrawer();
    activeView?.map?.resize();
  } else if (activeDocument()) {
    showStudio();
  } else {
    updateWorkspaceVisibility();
  }
}

function activeEditorContent() {
  return codeMirrorEditor ? codeMirrorEditor.value() : editor.value;
}

function focusActiveEditor() {
  if (codeMirrorEditor) codeMirrorEditor.focus();
  else editor.focus();
}

function clearCodeMirrorEditor() {
  codeMirrorEditor?.destroy();
  codeMirrorEditor = null;
}

function updateWebDraft(text) {
  trackEditorContent(text);
  if (!drawer.hidden) scheduleWebPreview();
}

function findArduinoSketch(filePath) {
  const parts = filePath.split("/");
  parts.pop();
  const rootName = vaultPath.split(/[\\/]+/).filter(Boolean).pop();
  while (true) {
    const name = parts.at(-1) ?? rootName;
    const sketch = parts.join("/");
    const primary = [...parts, `${name}.ino`].join("/");
    if (filesList.some(file => file.path === primary)) return sketch;
    if (!parts.length) return null;
    parts.pop();
  }
}

function currentArduinoTarget() {
  if (drawer.hidden || !ARDUINO_EXTENSIONS.has(currentFile?.ext)) return null;
  const sketchPath = findArduinoSketch(currentFile.path);
  return sketchPath === null ? null : { vaultPath, sketchPath };
}

function arduinoHeaders(filePath) {
  const parent = filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")));
  const sketch = findArduinoSketch(filePath) ?? parent;
  return filesList
    .filter(file => (file.ext === "h" || file.ext === "hpp") && file.path !== filePath)
    .filter(file => !sketch || file.path.startsWith(sketch + "/"))
    .map(file => sketch ? file.path.slice(sketch.length + 1) : file.path)
    .sort((a, b) => a.localeCompare(b));
}

async function readProjectJavaScript() {
  const path = currentFile.path;
  const root = vaultPath;
  const files = getWebFiles().filter(file => file.ext === "js" && file.path !== path);
  const drafts = new Map(files.map(file => [file.path, activeDraft(file.path)]));
  const paths = files.map(file => file.path).filter(filePath => drafts.get(filePath) === undefined);
  const contents = paths.length ? await invoke("read_web_files", { vaultPath: root, paths }) : [];
  paths.forEach((filePath, index) => drafts.set(filePath, contents[index]));
  return files.map(file => [file.path, drafts.get(file.path)]);
}

function getWebFiles() {
  const project = webProjectPath(currentFile.path);
  return filesList.filter(file =>
    WEB_EXTENSIONS.has(file.ext) && webProjectPath(file.path) === project
  ).sort((a, b) => a.path.localeCompare(b.path));
}

function updateWebTabs() {
  const project = webProjectPath(currentFile.path);
  const files = getWebFiles();
  const existing = [...webTabs.children];
  const byPath = new Map(existing.map(button => [button.dataset.path, button]));
  const buttons = files.map(file => {
    const button = byPath.get(file.path) ?? document.createElement("button");
    button.type = "button";
    button.className = "lab-btn";
    button.dataset.path = file.path;
    button.textContent = project ? file.path.slice(project.length + 1) : file.path;
    if (file.path === currentFile.path) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
    button.title = "Double-clique pour renommer";
    button.onclick = () => openFileInStudio(file);
    button.ondblclick = () => openRenameModal(file);
    return button;
  });
  if (buttons.length !== existing.length || buttons.some((button, index) => button !== existing[index])) {
    webTabs.replaceChildren(...buttons);
  }

  if (!files.some(file => file.path === webPagePath && isWebPage(file))) {
    const entry = project ? `${project}/index.html` : "index.html";
    webPagePath = (files.find(file => file.path.toLowerCase() === entry.toLowerCase())
      || files.find(isWebPage))?.path;
  }
}

function stopWebPreview() {
  clearTimeout(previewTimer);
  previewRequest++;
  previewFrame.hidden = true;
  previewFrame.removeAttribute("srcdoc");
}

function scheduleWebPreview() {
  clearTimeout(previewTimer);
  const request = ++previewRequest;
  previewTimer = setTimeout(() => refreshWebPreview(request), 220);
}

async function refreshWebPreview(request) {
  const page = webPagePath;
  if (!page) {
    previewFrame.hidden = true;
    previewFrame.removeAttribute("srcdoc");
    previewStatus.textContent = "Ajoute un fichier HTML pour afficher l’aperçu.";
    return;
  }

  const root = vaultPath;
  const readFiles = async (paths) => {
    const drafts = paths.map(activeDraft);
    const diskPaths = paths.filter((path, index) => drafts[index] === undefined);
    const contents = diskPaths.length ? await invoke("read_web_files", {
      vaultPath: root, paths: diskPaths,
    }) : [];
    let diskIndex = 0;
    return drafts.map(draft => draft ?? contents[diskIndex++]);
  };

  try {
    const files = getWebFiles();
    const [html] = await readFiles([page]);
    if (request !== previewRequest) return;
    const result = await buildWebPreview(html, page, files, readFiles);
    if (request !== previewRequest) return;
    if (previewFrame.srcdoc !== result.document) previewFrame.srcdoc = result.document;
    previewFrame.hidden = false;
    previewStatus.textContent = result.missing.length
      ? `Fichiers introuvables : ${result.missing.join(", ")}`
      : page.split("/").pop();
  } catch (err) {
    if (request !== previewRequest) return;
    previewStatus.textContent = String(err);
  }
}

function configureStudio() {
  const isWeb = WEB_EXTENSIONS.has(currentFile.ext);
  const isArduino = ARDUINO_EXTENSIONS.has(currentFile.ext);
  drawer.classList.toggle("is-web", isWeb);
  drawer.classList.toggle("is-arduino", isArduino);
  webTabs.hidden = !isWeb;
  webPreview.hidden = !isWeb;
  btnColor.hidden = !isWeb;
  btnArduinoCli.hidden = !isArduino;
  btnArduinoUpload.hidden = !isArduino;
  btnArduinoSchematic.hidden = !isArduino;
  if (ArduinoSchematic.isOpen && !ArduinoSchematic.matches(currentArduinoTarget())) ArduinoSchematic.hide();
  editorHost.hidden = isWeb || isArduino;
  codeMirrorEditorHost.hidden = !isWeb && !isArduino;
  studioConsole.hidden = isWeb;
  consoleTitle.textContent = isArduino ? "Arduino · Uno (AVR)" : "Console Python";
  btnRun.textContent = isWeb ? "↻ Aperçu" : isArduino ? "Compiler" : "▶ Run";
  btnRun.title = isWeb ? "Actualiser l’aperçu (Ctrl+Entrée)" :
    isArduino ? "Compiler pour Arduino Uno (Ctrl+Entrée)" : "Exécuter Python (Ctrl+Entrée)";
  arduinoSerial.show(isArduino);
  clearTimeout(savedLabelTimer);
  btnSave.textContent = "Sauver";
  if (isWeb) {
    updateWebTabs();
  } else {
    stopWebPreview();
    webPagePath = null;
    editor.placeholder = currentFile.ext === "py" ? "# Ctrl+Espace pour l’autocomplétion" : "";
  }
}

function syncCodeActions() {
  const ext = currentFile?.ext;
  const isArduino = ARDUINO_EXTENSIONS.has(ext);
  const isWeb = WEB_EXTENSIONS.has(ext);
  btnRun.disabled = isArduino ? arduinoCompiling : !isWeb && pythonRunning;
  btnArduinoUpload.disabled = !isArduino || arduinoCompiling || !arduinoSerial.canUpload();
  btnStop.hidden = isArduino || isWeb || !pythonRunning;
}

function syncMapMotion() {
  const shouldPause = userPaused3D || workspaceView === "files" || !drawer.hidden || graphLinkMode;
  if (activeView?.map?.setMotion) activeView.map.setMotion(!shouldPause);
  btnEco.textContent = userPaused3D ? "▶ 3D" : "⏸ 3D";
  btnEco.classList.toggle("is-active", userPaused3D);
  btnLite.textContent = liteMode ? "⚡ Eco ON" : "⚡ Eco";
  btnLite.classList.toggle("is-active", liteMode);
}

function isManualGraphLink(source, target) {
  const [first, second] = source < target ? [source, target] : [target, source];
  return graphManualLinks.get(first)?.has(second) ?? false;
}

function updateGraphLinkStatus(message, temporary = false) {
  clearTimeout(graphLinkTimer);
  linkStarsStatus.hidden = !message;
  linkStarsStatus.textContent = message;
  if (temporary) graphLinkTimer = setTimeout(() => { linkStarsStatus.hidden = true; }, 4200);
}

function finishGraphLinkMode(message = "") {
  graphLinkMode = false;
  graphLinkSource = null;
  btnLinkStars.setAttribute("aria-pressed", "false");
  updateGraphLinkStatus(message, Boolean(message));
  syncMapMotion();
  activeView?.map?.resize();
}

function selectGraphLinkSource(file) {
  graphLinkSource = file;
  updateGraphLinkStatus(`${file.path} sélectionné. Choisis le second fichier. Si un lien existe déjà, il sera retiré du graphe.`);
  activeView?.map?.resize();
}

async function activateGraphFile(file) {
  if (!graphLinkMode) return openFileInStudio(file);
  if (graphLinkPending || fileOperation) return;
  if (!graphLinkSource) {
    selectGraphLinkSource(file);
    return;
  }

  const source = graphLinkSource.path;
  const target = file.path;
  if (source === target) {
    updateGraphLinkStatus("Choisis une autre étoile pour terminer le lien.");
    return;
  }
  const linked = !(resolvedLinksMap[source]?.[target] || resolvedLinksMap[target]?.[source]);

  graphLinkPending = true;
  btnLinkStars.disabled = true;
  const root = vaultPath;
  try {
    const links = await invoke("set_graph_link", { vaultPath: root, source, target, linked });
    if (root !== vaultPath) return;
    graphLinksRevision++;
    refreshVaultGraph(links);
    finishGraphLinkMode(linked ? "Lien créé entre les deux étoiles." : "Lien retiré de la carte.");
  } catch (err) {
    if (root === vaultPath) updateGraphLinkStatus(`Lien non enregistré — ${err}`);
  } finally {
    graphLinkPending = false;
    btnLinkStars.disabled = false;
  }
}

async function openFileInStudio(fileObj) {
  if (!fileObj || fileOperation) return;
  const request = ++fileOpenRequest;
  const root = vaultPath;
  try {
    let doc = openDocuments.get(fileObj.path);
    if (!doc) {
      const content = await invoke("read_file", { vaultPath: root, relPath: fileObj.path });
      if (request !== fileOpenRequest || root !== vaultPath) return;
      const text = content.replace(/\r\n?/g, "\n");
      doc = { file: fileObj, text, saved: text, position: null, console: null };
      openDocuments.set(fileObj.path, doc);
    }
    drawer.hidden = false;
    if (currentFile?.path !== fileObj.path) mountStudio(doc);
    showStudio();
    renderOpenTabs();
    updateExplorer();
    if (document.getElementById("lab-modal").hidden) focusActiveEditor();
  } catch (err) {
    if (request === fileOpenRequest) alert("Erreur lecture fichier : " + err);
  }
}

function mountStudio(doc) {
  const previous = activeDocument();
  if (previous) {
    previous.position = codeMirrorEditor?.position() ?? {
      anchor: editor.selectionDirection === "backward" ? editor.selectionEnd : editor.selectionStart,
      head: editor.selectionDirection === "backward" ? editor.selectionStart : editor.selectionEnd,
      top: editor.scrollTop,
      left: editor.scrollLeft,
    };
  }
  if (!currentFile || webProjectPath(currentFile.path) !== webProjectPath(doc.file.path)) {
    webPagePath = null;
    stopWebPreview();
  }
  hideAutocomplete();
  clearCodeMirrorEditor();
  currentFile = doc.file;
  if (isWebPage(currentFile)) webPagePath = currentFile.path;
  drawerPath.textContent = currentFile.path;
  drawerBadge.textContent = currentFile.ext.toUpperCase();
  configureStudio();
  const isWeb = WEB_EXTENSIONS.has(currentFile.ext);
  if (isWeb || ARDUINO_EXTENSIONS.has(currentFile.ext)) {
    codeMirrorEditor = StudioEditor.createCodeEditor({
      parent: codeMirrorEditorHost,
      language: isWeb ? currentFile.ext : "cpp",
      content: doc.text,
      position: doc.position,
      onChange: isWeb ? updateWebDraft : trackEditorContent,
      getPath: () => doc.file.path,
      readProjectJavaScript,
      openColorPicker: openStudioColorPicker,
      getArduinoHeaders: () => arduinoHeaders(doc.file.path),
    });
  } else {
    editor.value = doc.text;
    const { anchor, head, top, left } = doc.position ?? { anchor: 0, head: 0, top: 0, left: 0 };
    editor.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? "backward" : "forward");
    editor.scrollTop = top;
    editor.scrollLeft = left;
    renderEditorVisuals();
  }
  renderDocumentConsole(doc);
}

function showStudio() {
  drawer.hidden = false;
  updateWorkspaceVisibility();
  if (WEB_EXTENSIONS.has(currentFile?.ext)) scheduleWebPreview();
}

function closeDrawer() {
  fileOpenRequest++;
  if (ArduinoSchematic.isOpen) ArduinoSchematic.hide();
  stopWebPreview();
  hideAutocomplete();
  drawer.hidden = true;
  updateWorkspaceVisibility();
}

function removeOpenDocument(path) {
  const paths = [...openDocuments.keys()];
  const index = paths.indexOf(path);
  openDocuments.delete(path);
  let nextFile;
  if (currentFile?.path === path) {
    currentFile = null;
    clearCodeMirrorEditor();
    closeDrawer();
    nextFile = openDocuments.get(paths[index + 1] ?? paths[index - 1])?.file;
  }
  renderOpenTabs();
  updateExplorer();
  return nextFile;
}

async function closeFileTab(path) {
  const doc = openDocuments.get(path);
  if (!doc || fileOperation) return;
  if (isDirty(doc) && !confirm(`Fermer « ${path} » sans enregistrer ?`)) return;
  fileOpenRequest++;
  const nextFile = removeOpenDocument(path);
  if (nextFile) await openFileInStudio(nextFile);
  else if (!drawer.hidden && WEB_EXTENSIONS.has(currentFile?.ext) && codeMirrorEditor) {
    codeMirrorEditor.invalidateProject();
    scheduleWebPreview();
  }
}

function renderDocumentConsole(doc) {
  const atBottom = consoleOut.scrollHeight - consoleOut.scrollTop - consoleOut.clientHeight < 20;
  consoleOut.textContent = doc.console?.text ?? "";
  if (atBottom) consoleOut.scrollTop = consoleOut.scrollHeight;
  consoleOut.classList.toggle("has-error", Boolean(doc.console?.error));
  consoleStatus.textContent = doc.console?.status ?? "Prêt";
}

function setDocumentConsole(doc, text, status, error = false) {
  doc.console = { text, status, error };
  if (doc === activeDocument()) renderDocumentConsole(doc);
}

function extractRunnablePython(text, ext) {
  if (ext === "py") return text;
  const fence = "\x60\x60\x60";
  const re = new RegExp(fence + "(?:python|py)\\s*\\r?\\n([\\s\\S]*?)" + fence, "gi");
  const blocks = [...text.matchAll(re)].map((m) => m[1]);
  return blocks.length ? blocks.join("\n\n") : text;
}

async function compileArduino(doc, { upload = false, simulation = false } = {}) {
  if (arduinoCompiling || fileOperation) return;
  if (upload && !arduinoSerial.canUpload()) return;
  const sketchPath = findArduinoSketch(doc.file.path);
  if (sketchPath === null) {
    setDocumentConsole(doc, "Le dossier du croquis doit contenir un fichier .ino du même nom. « + Arduino » crée cette structure.", "Croquis introuvable", true);
    return;
  }

  const root = vaultPath;
  if (activeDocument() === doc) trackEditorContent(activeEditorContent());
  const port = upload ? arduinoSerial.selectedPort() : null;
  const parameters = {
    vaultPath: root,
    sketchPath,
    cliPath: localStorage.getItem("sbbh_arduino_cli") || null,
  };
  arduinoCompiling = true;
  arduinoSerial.setBusy(true);
  arduinoSerial.setPanel("build");
  setDocumentConsole(doc, "Cible Arduino Uno (AVR)\n", "Compilation…");
  try {
    fileOperation = true;
    fileOpenRequest++;
    try {
      for (const opened of openDocuments.values()) {
        if (ARDUINO_EXTENSIONS.has(opened.file.ext) && isDirty(opened)
            && findArduinoSketch(opened.file.path) === sketchPath) {
          await persistDocument(opened, root);
        }
      }
    } finally {
      fileOperation = false;
    }
    const result = await invoke("compile_arduino", { ...parameters, withFirmware: simulation });
    const output = result => [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    const text = output(result);
    const ok = result.exit_code === 0;
    if (ok && port) {
      setDocumentConsole(doc, text, `Téléversement sur ${port}…`);
      await arduinoSerial.closePort();
      const flashed = await invoke("upload_arduino", { ...parameters, port });
      const flashedOk = flashed.exit_code === 0;
      setDocumentConsole(doc, [text, output(flashed)].filter(Boolean).join("\n\n"),
        flashedOk ? `Téléversé sur ${port}` : `Échec du téléversement sur ${port}`, !flashedOk);
      return;
    }
    const compiled = simulation ? text : [text, "Ouvre Schéma → Compiler et simuler pour vérifier les LED."].filter(Boolean).join("\n\n");
    setDocumentConsole(doc, ok ? compiled : text || `Arduino CLI a renvoyé le code ${result.exit_code}.`,
      `${ok ? "Compilé" : "Échec"} · ${result.duration_ms} ms`, !ok);
    return ok ? result : undefined;
  } catch (err) {
    setDocumentConsole(doc, String(err), "Échec", true);
  } finally {
    arduinoCompiling = false;
    arduinoSerial.setBusy(false);
  }
}

async function runCurrentCode() {
  const doc = activeDocument();
  if (!doc) return;
  if (WEB_EXTENSIONS.has(currentFile.ext)) {
    clearTimeout(previewTimer);
    // Explicit refresh also resets the state of a page whose source is unchanged.
    previewFrame.removeAttribute("srcdoc");
    await refreshWebPreview(++previewRequest);
    return;
  }
  if (ARDUINO_EXTENSIONS.has(currentFile.ext)) {
    await compileArduino(doc);
    return;
  }
  if (pythonRunning) return;
  const codeToRun = extractRunnablePython(editor.value, currentFile.ext);
  if (!codeToRun.trim()) return;

  const root = vaultPath;
  pythonRunning = true;
  syncCodeActions();
  if (!await saveCurrentFile(true)) {
    pythonRunning = false;
    syncCodeActions();
    return;
  }
  setDocumentConsole(doc, "", "En cours…");

  const output = new Channel();
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  let text = "";
  let hasError = false;
  let trimmed = false;
  let repaint;
  const append = chunk => {
    text += chunk;
    const limit = 120_000;
    if (text.length > limit) {
      text = text.slice(-limit);
      trimmed = true;
    }
  };
  const displayedOutput = () => trimmed ? "… début de la sortie tronqué …\n" + text : text;
  output.onmessage = ({ stream, bytes }) => {
    hasError ||= stream === "stderr";
    append(decoders[stream].decode(Uint8Array.from(bytes), { stream: true }));
    if (repaint === undefined) {
      repaint = requestAnimationFrame(() => {
        repaint = undefined;
        setDocumentConsole(doc, displayedOutput(), "En cours…", hasError);
      });
    }
  };

  try {
    const res = await invoke("run_python", {
      code: codeToRun,
      relPath: doc.file.ext === "py" ? doc.file.path : null,
      vaultPath: root,
      pythonBin: localStorage.getItem("sbbh_python_bin") || null,
      output,
    });
    for (const decoder of Object.values(decoders)) append(decoder.decode());
    const status = res.stopped ? "Arrêté" : `Code ${res.exit_code} · ${res.duration_ms} ms`;
    setDocumentConsole(doc, displayedOutput() || "(Aucune sortie texte)", status,
      hasError || (!res.stopped && res.exit_code !== 0));
  } catch (err) {
    append((text ? "\n" : "") + String(err));
    setDocumentConsole(doc, displayedOutput(), "Erreur", true);
  } finally {
    if (repaint !== undefined) cancelAnimationFrame(repaint);
    pythonRunning = false;
    syncCodeActions();
  }
}

async function persistDocument(doc, root) {
  const content = doc.text;
  await invoke("save_file", { vaultPath: root, relPath: doc.file.path, content });
  doc.saved = content;
  updateTabDirtyState(doc);
}

async function saveCurrentFile(silent = false) {
  const doc = activeDocument();
  if (!doc || fileOperation) return false;
  const file = doc.file;
  const root = vaultPath;
  trackEditorContent(activeEditorContent());
  fileOperation = true;
  fileOpenRequest++;
  try {
    await persistDocument(doc, root);
    if (!silent) {
      if (WEB_EXTENSIONS.has(file.ext)) {
        btnSave.textContent = "Sauvé ✓";
        clearTimeout(savedLabelTimer);
        savedLabelTimer = setTimeout(() => { btnSave.textContent = "Sauver"; }, 1200);
      } else {
        setDocumentConsole(doc, doc.console?.text ?? "", "Sauvegardé ✓", doc.console?.error);
      }
      await reloadVault();
    }
    return true;
  } catch (err) {
    alert("Erreur sauvegarde : " + err);
    return false;
  } finally {
    fileOperation = false;
  }
}

async function deleteCurrentFile() {
  if (!currentFile || fileOperation) return;
  const { path } = currentFile;
  if (!confirm(`Supprimer définitivement "${path}" ?`)) return;
  fileOperation = true;
  fileOpenRequest++;
  let nextFile;
  try {
    await invoke("delete_file", { vaultPath, relPath: path });
    nextFile = removeOpenDocument(path);
    await reloadVault();
  } catch (err) {
    alert(String(err));
  } finally {
    fileOperation = false;
  }
  if (nextFile) await openFileInStudio(nextFile);
}

function openRenameModal(file = currentFile) {
  if (!file || drawer.hidden || fileOperation) return;
  const filename = file.path.split("/").pop();
  const dot = filename.lastIndexOf(".");
  const extension = filename.slice(dot);
  openModal(
    "Renommer le fichier",
    `Saisis le nouveau nom. L’extension ${extension} est conservée.`,
    filename.slice(0, dot),
    async (name) => {
      if (fileOperation) return;
      const newStem = name.toLowerCase().endsWith(extension.toLowerCase())
        ? name.slice(0, -extension.length) : name;
      fileOperation = true;
      fileOpenRequest++;
      try {
        const path = await invoke("rename_file", { vaultPath, relPath: file.path, newStem });
        if (path !== file.path) {
          const renamed = { ...file, path, basename: newStem };
          const doc = openDocuments.get(file.path);
          if (doc) {
            const entries = [...openDocuments];
            doc.file = renamed;
            openDocuments.clear();
            for (const [key, value] of entries) openDocuments.set(key === file.path ? path : key, value);
          }
          if (webPagePath === file.path) webPagePath = path;
          if (currentFile?.path === file.path) {
            currentFile = renamed;
            drawerPath.textContent = path;
          }
          renderOpenTabs();
          await reloadVault();
        }
      } finally {
        fileOperation = false;
        if (!drawer.hidden) focusActiveEditor();
      }
    }
  );
}

/* ============================================================
   4. Shim de compatibilité pour charger main.js
   ============================================================ */
class MiniEmitter {
  constructor() { this.map = new Map(); }
  on(ev, cb) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(cb);
    return { ev, cb };
  }
  trigger(ev, ...args) { this.map.get(ev)?.forEach((cb) => cb(...args)); }
}

const vaultEmitter = new MiniEmitter();
const metaEmitter = new MiniEmitter();
let resolvedLinksMap = {};
let fileCacheMap = new Map();

function buildObsidianApp() {
  const leaf = {
    view: null,
    async setViewState() {},
    openFile(file) { activateGraphFile(file); },
  };
  return {
    scope: { register() { return {}; }, unregister() {} },
    vault: {
      getMarkdownFiles: () => filesList,
      getFileByPath: (p) => filesList.find((f) => f.path === p) || null,
      on: (ev, cb) => vaultEmitter.on(ev, cb),
    },
    metadataCache: {
      get resolvedLinks() { return resolvedLinksMap; },
      getFileCache: (f) => fileCacheMap.get(f.path) || null,
      on: (ev, cb) => metaEmitter.on(ev, cb),
    },
    workspace: {
      onLayoutReady: (cb) => setTimeout(cb, 0),
      getLeavesOfType: () => (leaf.view ? [leaf] : []),
      getLeaf: () => leaf,
      revealLeaf: async () => {},
    },
  };
}

const obsidianShim = {
  Plugin: class {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    async loadData() {
      try { return JSON.parse(localStorage.getItem("sbbh_settings") || "{}"); } catch { return {}; }
    }
    async saveData(d) { localStorage.setItem("sbbh_settings", JSON.stringify(d)); }
    registerView(type, factory) { this._viewFactory = factory; }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
  },
  ItemView: class {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = appInstance;
      this.contentEl = document.getElementById("map-root");
    }
    register() {}
    registerEvent() {}
    registerDomEvent(el, ev, cb) { el.addEventListener(ev, cb); }
  },
  PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
  Setting: class {
    setName() { return this; } setDesc() { return this; }
    addDropdown() { return this; } addText() { return this; }
    addTextArea() { return this; } addToggle() { return this; } addButton() { return this; }
  },
  Scope: class {
    register(mods, key, cb) {
      const fn = (e) => {
        if (!drawer.hidden || workspaceView === "files") return;
        if (e.key === key && cb(e) === false) e.preventDefault();
      };
      window.addEventListener("keydown", fn);
      return fn;
    }
    unregister(fn) { window.removeEventListener("keydown", fn); }
  },
  Keymap: { isModEvent: (e) => !!(e && (e.ctrlKey || e.metaKey)) },
  debounce(fn, wait) {
    let timer = null;
    const wrapped = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  },
  normalizePath: (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""),
  getAllTags: (cache) => (cache?.tags || []).map((t) => t.tag),
};

const appInstance = buildObsidianApp();

async function reloadVault() {
  const root = vaultPath;
  const revision = graphLinksRevision;
  const [entries, links, folders] = await Promise.all([
    invoke("scan_vault", { vaultPath: root }),
    invoke("list_graph_links", { vaultPath: root }).catch(err => {
      if (root === vaultPath) updateGraphLinkStatus(String(err), true);
      return savedGraphLinks;
    }),
    invoke("list_vault_folders", { vaultPath: root }),
  ]);
  if (root !== vaultPath) return;
  filesList = entries.map((e) => ({
    path: e.path,
    basename: e.basename,
    ext: e.ext,
    folder: e.folder,
    stat: { mtime: e.mtime },
    _meta: e,
  }));
  vaultFolders = folders;
  updateExplorer();
  refreshVaultGraph(revision === graphLinksRevision ? links : savedGraphLinks);
  if (!drawer.hidden && WEB_EXTENSIONS.has(currentFile?.ext)) {
    codeMirrorEditor?.invalidateProject();
    updateWebTabs();
    scheduleWebPreview();
  }
}

function refreshVaultGraph(links) {
  savedGraphLinks = links;
  const byName = new Map();
  filesList.forEach((f) => {
    byName.set(f.basename.toLowerCase(), f.path);
    byName.set(f.path.toLowerCase(), f.path);
  });

  resolvedLinksMap = {};
  fileCacheMap = new Map();

  for (const f of filesList) {
    const m = f._meta;
    fileCacheMap.set(f.path, {
      frontmatter: { title: m.title },
      tags: m.tags.map((t) => ({ tag: "#" + t })),
      // The graph treats headings as ideas. Python symbols stay available in search.
      headings: f.ext === "md" ? m.headings.map((h) => ({ level: 2, heading: h })) : [],
    });
    const targets = {};
    for (const link of m.links) {
      const targetPath = byName.get(link.toLowerCase());
      if (targetPath && targetPath !== f.path) targets[targetPath] = 1;
    }
    resolvedLinksMap[f.path] = targets;
  }

  graphManualLinks = new Map();
  for (const [source, target] of links.manual) {
    if (source !== target && fileCacheMap.has(source) && fileCacheMap.has(target)) {
      const [first, second] = source < target ? [source, target] : [target, source];
      if (!graphManualLinks.has(first)) graphManualLinks.set(first, new Set());
      graphManualLinks.get(first).add(second);
      resolvedLinksMap[source][target] = 1;
    }
  }
  for (const [source, target] of links.hidden) {
    if (resolvedLinksMap[source]) delete resolvedLinksMap[source][target];
    if (resolvedLinksMap[target]) delete resolvedLinksMap[target][source];
  }
  vaultEmitter.trigger("create");
  if (activeView) activeView.refresh();
}

/* ============================================================
   5. Modale, Recherche & Raccourcis
   ============================================================ */
function openModal(title, desc, defaultVal, onConfirm) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-desc").textContent = desc;
  const input = document.getElementById("modal-input");
  input.value = defaultVal;
  modalCallback = onConfirm;
  document.getElementById("lab-modal").hidden = false;
  input.focus();
  input.select();
}

function closeModal() {
  document.getElementById("lab-modal").hidden = true;
  modalCallback = null;
}

document.getElementById("modal-cancel").onclick = closeModal;
document.getElementById("modal-confirm").onclick = async () => {
  const val = document.getElementById("modal-input").value.trim();
  const cb = modalCallback;
  closeModal();
  if (!val || !cb) return;
  try {
    await cb(val);
  } catch (err) {
    alert(String(err));
  }
};
document.getElementById("modal-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("modal-confirm").click();
  if (e.key === "Escape") {
    e.stopPropagation();
    closeModal();
    if (!drawer.hidden) focusActiveEditor();
  }
});

btnEco.onclick = () => {
  userPaused3D = !userPaused3D;
  localStorage.setItem("sbbh_eco_paused", userPaused3D ? "1" : "0");
  syncMapMotion();
};

btnLite.onclick = () => {
  if (fileOperation || ArduinoSchematic.isSaving) return;
  if ((hasUnsavedDocuments() || ArduinoSchematic.hasUnsavedChanges) &&
      !confirm("Changer de mode graphique sans enregistrer les modifications ?")) return;
  liteMode = !liteMode;
  localStorage.setItem("sbbh_lite_mode", liteMode ? "1" : "0");
  location.reload();
};

btnLinkStars.onclick = () => {
  if (fileOperation || graphLinkPending) return;
  if (graphLinkMode) {
    finishGraphLinkMode();
    return;
  }
  const openFile = drawer.hidden ? null : currentFile;
  if (openFile) closeDrawer();
  graphLinkMode = true;
  btnLinkStars.setAttribute("aria-pressed", "true");
  updateGraphLinkStatus("Pour relier ou délier deux fichiers, choisis la première étoile ou utilise la recherche.");
  syncMapMotion();
  if (openFile) selectGraphLinkSource(openFile);
};

btnColor.onclick = () => codeMirrorEditor?.pickColor();

btnArduinoCli.onclick = () => openModal(
  "Chemin d’Arduino CLI",
  "Indique le chemin complet vers arduino-cli.exe, ou saisis « auto » pour la détection automatique.",
  localStorage.getItem("sbbh_arduino_cli") || "auto",
  path => {
    if (path.toLowerCase() === "auto") localStorage.removeItem("sbbh_arduino_cli");
    else localStorage.setItem("sbbh_arduino_cli", path.replace(/^"|"$/g, ""));
  }
);
btnArduinoUpload.onclick = () => {
  const doc = activeDocument();
  if (doc && ARDUINO_EXTENSIONS.has(doc.file.ext)) compileArduino(doc, { upload: true });
};
btnArduinoSchematic.onclick = async () => {
  const target = currentArduinoTarget();
  if (!target) {
    alert("Ouvre un fichier appartenant à un croquis Arduino.");
    return;
  }
  if (ArduinoSchematic.isOpen) {
    ArduinoSchematic.hide();
    return;
  }
  const stillActive = () => {
    const active = currentArduinoTarget();
    return active?.vaultPath === target.vaultPath && active?.sketchPath === target.sketchPath;
  };
  try {
    await ArduinoSchematic.open(target, async () => {
      if (arduinoCompiling || fileOperation) throw new Error("Une opération Arduino est déjà en cours.");
      const doc = activeDocument();
      if (!doc || !stillActive()) throw new Error("Ouvre un fichier du croquis affiché.");
      const result = await compileArduino(doc, { simulation: true });
      if (!result?.firmware) throw new Error(doc.console?.text || "La compilation n’a pas produit de firmware.");
      return result.firmware;
    }, stillActive);
  } catch (error) {
    alert(String(error));
  }
};

document.getElementById("btn-new").onclick = () => {
  const project = !drawer.hidden && WEB_EXTENSIONS.has(currentFile?.ext)
    ? webProjectPath(currentFile.path)
    : null;
  openModal(
    "Nouveau fichier",
    "Chemin relatif au dossier (ex. Python/algo.py, Arduino/Blink/broches.h ou Sites/mon-site/contact.html)",
    project === null ? "Python/nouveau_script.py" : [project, "nouveau.html"].filter(Boolean).join("/"),
    async (rawPath) => {
      const relPath = rawPath.replace(/\\/g, "/");
      const ext = relPath.split(".").pop().toLowerCase();
      const starters = {
        py: '# #python\n\ndef main():\n    print("Bonjour !")\n\nif __name__ == "__main__":\n    main()\n',
        md: `# ${relPath.split("/").pop().slice(0, -3)}\n\n## Idée\n`,
        html: '<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <title>Nouvelle page</title>\n</head>\n<body>\n  <h1>Nouvelle page</h1>\n</body>\n</html>\n',
      };
      const content = starters[ext === "htm" ? "html" : ext] ?? "";
      await invoke("save_file", { vaultPath, relPath, content, createOnly: true });
      await reloadVault();
      await openFileInStudio(filesList.find(file => file.path === relPath));
    }
  );
};

document.getElementById("btn-new-site").onclick = () => {
  openModal(
    "Nouveau site Web",
    "Crée un dossier dans Sites avec index.html, style.css et script.js.",
    "mon-site",
    async (name) => {
      const path = await invoke("create_web_project", { vaultPath, name });
      await reloadVault();
      await openFileInStudio(filesList.find(file => file.path === path));
    }
  );
};

document.getElementById("btn-new-arduino").onclick = () => {
  openModal(
    "Nouveau croquis Arduino",
    "Le dossier du croquis et le fichier .ino porteront le même nom.",
    "Blink",
    async name => {
      const path = await invoke("create_arduino_project", { vaultPath, name });
      await reloadVault();
      await openFileInStudio(filesList.find(file => file.path === path));
    }
  );
};

document.getElementById("btn-vault").onclick = () => {
  openModal(
    "Changer le dossier (Vault / Labo)",
    "Chemin complet vers le dossier contenant tes scripts, tes sites et tes notes.",
    vaultPath,
    async (newPath) => {
      if (newPath === vaultPath) return;
      if (fileOperation || ArduinoSchematic.isSaving) return;
      if ((hasUnsavedDocuments() || ArduinoSchematic.hasUnsavedChanges) &&
          !confirm("Changer de dossier sans enregistrer les modifications ?")) return;
      fileOperation = true;
      fileOpenRequest++;
      try {
        await invoke("scan_vault", { vaultPath: newPath });
        finishGraphLinkMode();
        closeDrawer();
        ArduinoSchematic.reset();
        currentFile = null;
        clearCodeMirrorEditor();
        openDocuments.clear();
        savedGraphLinks = { manual: [], hidden: [] };
        renderOpenTabs();
        vaultPath = newPath;
        localStorage.setItem("sbbh_vault_path", vaultPath);
        await reloadVault();
      } finally {
        fileOperation = false;
      }
    }
  );
};

document.getElementById("btn-reload").onclick = () => reloadVault().catch(err => alert(String(err)));
btnRun.onclick = runCurrentCode;
btnStop.onclick = () => invoke("stop_python").catch(err => alert(String(err)));
btnSave.onclick = () => saveCurrentFile(false);
document.getElementById("btn-delete").onclick = deleteCurrentFile;
viewGraph.onclick = () => setWorkspaceView("graph");
viewFiles.onclick = () => setWorkspaceView("files");
btnCloseDrawer.onclick = () => {
  if (workspaceView === "files") closeFileTab(currentFile?.path);
  else closeDrawer();
};
drawerPath.ondblclick = () => openRenameModal();
drawerPath.onclick = (event) => {
  if (event.detail === 0) openRenameModal();
};

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { searchResults.hidden = true; return; }
  const matches = filesList.filter(
    (f) =>
      f.path.toLowerCase().includes(q) ||
      f._meta.headings.some((h) => h.toLowerCase().includes(q)) ||
      f._meta.tags.some((t) => t.includes(q))
  ).slice(0, 12);

  searchResults.innerHTML = "";
  if (!matches.length) { searchResults.hidden = true; return; }

  for (const m of matches) {
    const btn = document.createElement("button");
    btn.className = "lab-search-item";
    btn.innerHTML = `<span>${escapeHtml(m._meta.title)}</span><small>${escapeHtml(m.folder)}</small>`;
    btn.onclick = () => {
      searchResults.hidden = true;
      searchInput.value = "";
      activateGraphFile(m);
    };
    searchResults.appendChild(btn);
  }
  searchResults.hidden = false;
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".lab-search-wrap")) searchResults.hidden = true;
});

window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || !document.getElementById("lab-modal").hidden || colorDialog.open
      || document.getElementById("updates-dialog").open) return;
  if (e.key === "F2" && !drawer.hidden) {
    e.preventDefault();
    openRenameModal();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !drawer.hidden) {
    e.preventDefault();
    saveCurrentFile(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !drawer.hidden) {
    e.preventDefault();
    runCurrentCode();
  } else if (e.key === "Escape" && !e.defaultPrevented && graphLinkMode && !graphLinkPending) {
    finishGraphLinkMode();
  } else if (e.key === "Escape" && !e.defaultPrevented && !drawer.hidden && acPopup.hidden) {
    if (workspaceView === "graph") closeDrawer();
  }
});

/* ============================================================
   6. Boot + optimisation agressive GPU/RAM sur main.js
   ============================================================ */
(async function boot() {
  updateWorkspaceVisibility();
  measureCharWidth();

  if (!vaultPath) {
    vaultPath = await invoke("get_default_vault");
    localStorage.setItem("sbbh_vault_path", vaultPath);
  }
  await reloadVault();

  let mainSource = await fetch("./main.js").then((r) => r.text());

  // Optimisations RAM & GPU en mémoire (sans toucher à main.js sur disque) :
  // 1) Texture ciel 1024x512 au lieu de 4096x2048
  // 2) Framebuffers 8-bit au lieu de 16-bit float (divise par 2 la VRAM bloom)
  // 3) Moins d'étapes de raymarching + résolution interne réduite + plafond 30 FPS au repos
  mainSource = mainSource
    .replace(
      'N?Et(N,"idea"):Et(i.filter(R=>R.region===a.name).length,"page")',
      'Et(i.filter(R=>R.region===a.name).length,"fichier")+(N?" · "+Et(N,"idée"):"")'
    )
    .replace(
      'let Y=O===z||F===z;l.beginPath(),l.moveTo(R[O].x,R[O].y),l.lineTo(R[F].x,R[F].y),l.strokeStyle=Y?"#ffffff":"#bdbdbd",l.globalAlpha=U*(Y?.62:z===null?.075:.035),l.lineWidth=Y?1.1:.55',
      'let Y=O===z||F===z,manual=isManualGraphLink(i[O].path,i[F].path);l.beginPath(),l.moveTo(R[O].x,R[O].y),l.lineTo(R[F].x,R[F].y),l.strokeStyle=manual?"#c795ff":Y?"#ffffff":"#bdbdbd",l.globalAlpha=U*(manual?.72:Y?.62:z===null?.075:.035),l.lineWidth=manual?1.6:Y?1.1:.55'
    )
    .replace(
      "l.arc(U.x,U.y,xe,0,Math.PI*2),l.fill()}let F=Q",
      'l.arc(U.x,U.y,xe,0,Math.PI*2),l.fill();if(isGraphLinkSource(i[U.i].path)){l.globalAlpha=.95,l.strokeStyle="#c795ff",l.lineWidth=1.5,l.beginPath(),l.arc(U.x,U.y,xe+5,0,Math.PI*2),l.stroke()}}let F=Q'
    )
    .replace("P.width=4096,P.height=2048", "P.width=1024,P.height=512")
    .replace('r=!!e.getExtension("EXT_color_buffer_float")', "r=!1")
    .replace("y.steps=t.region?176:136", "y.steps=t.region?84:64")
    .replace(
      "Math.min(window.devicePixelRatio||1,1.5,Math.sqrt(145e4/Math.max(1,B*w)))",
      "Math.min(0.8,Math.sqrt(50e4/Math.max(1,B*w)))"
    )
    .replace(
      "Math.min(window.devicePixelRatio||1,Math.sqrt(6e6/Math.max(1,u*D)))",
      "Math.min(0.8,Math.sqrt(6e5/Math.max(1,u*D)))"
    )
    .replace(
      "if(we&&!g.hidden&&Pt){ue===null&&(ue=a);let s=Math.max(0,Math.min(.1,(a-ue)/1e3));pe+=s,!S&&z===null&&!re&&!v&&(de+=s*.035),ue=a,he||ge()}",
      "if(we&&!g.hidden&&Pt){if(ue===null||a-ue>=33){ue===null&&(ue=a);let s=Math.max(0,Math.min(.1,(a-ue)/1e3));pe+=s,!S&&z===null&&!re&&!v&&(de+=s*.035),ue=a,he||ge()}}"
    );

  // Mode Eco RAM : désactive totalement les 2 contextes WebGL2 et utilise le rendu 2D natif de main.js
  if (liteMode) {
    mainSource = mainSource
      .replace("Ae=Ht(C,Le)", "Ae=null")
      .replace('ve=Ut(Z,Le,a??g.createElement("canvas"))', "ve=null");
  }

  const mod = { exports: {} };
  const runner = new Function("require", "module", "exports", "isManualGraphLink", "isGraphLinkSource", mainSource);
  runner((name) => {
    if (name === "obsidian") return obsidianShim;
    throw new Error("Module inconnu : " + name);
  }, mod, mod.exports, isManualGraphLink, path => graphLinkMode && graphLinkSource?.path === path);

  const PluginClass = mod.exports.default;
  const plugin = new PluginClass(appInstance, { id: "second-brain-black-hole" });
  await plugin.onload();

  const leaf = appInstance.workspace.getLeaf("tab");
  activeView = plugin._viewFactory(leaf);
  leaf.view = activeView;
  await activeView.onOpen();

  syncMapMotion();
  window.addEventListener("resize", () => activeView.onResize());
})();
