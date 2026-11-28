import {
  acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap,
  completionKeymap, insertCompletionText, startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { javascript, localCompletionSource } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { colorSwatches, editWebColor } from "../web/color-swatches.js";
import { arduinoCompletion } from "../arduino/arduino-completion.js";

const workerURL = new URL("javascript-worker.js", document.currentScript.src);
let worker;
let workerProject;
let nextId = 0;
const pending = new Map();

function resetWorker() {
  worker?.terminate();
  worker = null;
  workerProject = null;
  for (const { reject } of pending.values()) reject(new Error("Moteur JavaScript indisponible."));
  pending.clear();
}

function askWorker(query, project) {
  if (!worker) {
    worker = new Worker(workerURL);
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) {
        workerProject = null;
        request.reject(new Error(data.error));
      } else {
        request.resolve(data);
      }
    };
    worker.onerror = resetWorker;
  }
  const files = workerProject === project ? undefined : project;
  workerProject = project;
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...query, project: files });
  });
}

const editorTheme = EditorView.theme({
  "&": { fontSize: "13px", backgroundColor: "#101116" },
  ".cm-scroller": { fontFamily: "var(--font-monospace)", lineHeight: "1.6" },
  ".cm-content, .cm-gutter": { padding: "10px 0" },
  ".cm-gutters": { backgroundColor: "#14151d", color: "#82869b" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#222331" },
});

const completionTypes = {
  "alias": "variable", "class": "class", "const": "constant", "function": "function",
  "getter": "property", "keyword": "keyword", "let": "variable", "method": "method",
  "module": "namespace", "property": "property", "var": "variable",
};

function createCodeEditor({ parent, language, content, position, onChange, getPath, readProjectJavaScript, openColorPicker, getArduinoHeaders }) {
  let project;
  let disposed = false;

  async function completeJavaScript(context) {
    const token = context.matchBefore(/[\w$]+/);
    if (!context.explicit && !token && context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos) !== ".") {
      return null;
    }

    const path = getPath();
    context.addEventListener("abort", () => {}, { onDocChange: true });
    try {
      project ??= readProjectJavaScript();
      const files = await project;
      if (context.aborted || disposed || path !== getPath()) return null;
      const result = await askWorker({ path, text: context.state.doc.toString(), pos: context.pos }, files);
      if (context.aborted || disposed || path !== getPath()) return null;
      const from = result.span?.start ?? token?.from ?? context.pos;
      const to = result.span ? from + result.span.length : context.pos;
      return {
        from, to,
        options: result.entries.map(entry => ({
          label: entry.name,
          type: completionTypes[entry.kind] ?? "variable",
          apply: entry.replacementSpan ? (view) => {
            const { start, length } = entry.replacementSpan;
            view.dispatch(insertCompletionText(view.state, entry.insertText ?? entry.name, start, start + length));
          } : entry.insertText ?? entry.name,
        })),
      };
    } catch {
      project = null;
      return !disposed && !context.aborted ? localCompletionSource(context) : null;
    }
  }

  const isCpp = language === "cpp";
  const support = { js: javascript, ts: () => javascript({ typescript: true }), css, html, htm: html, cpp, json, rs: rust }[language]();
  const source = { js: completeJavaScript, cpp: arduinoCompletion(getArduinoHeaders) }[language];
  const completion = autocompletion(source ? { override: [source] } : {});
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: content,
      selection: position && {
        anchor: Math.min(position.anchor, content.length),
        head: Math.min(position.head, content.length),
      },
      extensions: [
        lineNumbers(), foldGutter(), history(), highlightActiveLine(), highlightActiveLineGutter(),
        indentOnInput(), bracketMatching(), closeBrackets(), support, completion, oneDark, editorTheme,
        isCpp ? [] : colorSwatches(openColorPicker),
        EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({ "aria-label": `Éditeur ${language.toUpperCase()} (Ctrl+Espace pour les suggestions)` }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        keymap.of([
          ...completionKeymap, ...closeBracketsKeymap,
          { key: "Ctrl-Space", run: startCompletion },
          { key: "Enter", run: acceptCompletion },
          { key: "Tab", run: acceptCompletion },
          ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
        ]),
      ],
    }),
  });
  if (position) {
    view.scrollDOM.scrollTop = position.top;
    view.scrollDOM.scrollLeft = position.left;
  }
  return {
    value: () => view.state.doc.toString(),
    focus: () => view.focus(),
    position: () => ({
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      top: view.scrollDOM.scrollTop,
      left: view.scrollDOM.scrollLeft,
    }),
    pickColor: () => editWebColor(view, openColorPicker),
    invalidateProject: () => { project = null; },
    destroy: () => {
      disposed = true;
      view.destroy();
    },
  };
}

window.StudioEditor = { createCodeEditor };
