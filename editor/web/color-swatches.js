import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";

const hexPattern = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

function colorAtCursor(state, pos) {
  const tree = syntaxTree(state);
  for (const side of [1, -1]) {
    const node = tree.resolveInner(pos, side);
    if (node.name === "ColorLiteral" && hexPattern.test(state.sliceDoc(node.from, node.to))) {
      return { from: node.from, to: node.to };
    }
  }
  return state.selection.main;
}

export function editWebColor(view, openPicker, range = null) {
  const { state } = view;
  const { main } = state.selection;
  const { from, to } = range ?? (main.empty ? colorAtCursor(state, main.head) : main);
  openPicker(state.sliceDoc(from, to), hex => {
    if (view.state.doc !== state.doc) return;
    view.dispatch({
      changes: { from, to, insert: hex },
      selection: { anchor: from + hex.length },
      userEvent: "input",
    });
    view.focus();
  });
}

class ColorSwatch extends WidgetType {
  constructor(hex, openPicker) {
    super();
    this.hex = hex;
    this.openPicker = openPicker;
  }

  eq(other) { return other.hex === this.hex; }

  toDOM(view) {
    const button = view.dom.ownerDocument.createElement("button");
    button.className = "lab-color-swatch";
    button.type = "button";
    button.style.backgroundColor = this.hex;
    button.title = "Modifier " + this.hex;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", event => {
      event.preventDefault();
      const from = view.posAtDOM(button);
      const to = from + this.hex.length;
      if (view.state.sliceDoc(from, to) === this.hex) {
        editWebColor(view, this.openPicker, { from, to });
      }
    });
    return button;
  }
}

export function colorSwatches(openPicker) {
  function decorate(view) {
    const decorations = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter(node) {
          if (node.name !== "ColorLiteral") return;
          const hex = view.state.sliceDoc(node.from, node.to);
          if (hexPattern.test(hex)) {
            decorations.push(Decoration.widget({
              widget: new ColorSwatch(hex, openPicker),
              side: -1,
            }).range(node.from));
          }
        },
      });
    }
    return Decoration.set(decorations, true);
  }
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = decorate(view); }
    update({ view, state, startState, docChanged, viewportChanged }) {
      if (docChanged || viewportChanged || syntaxTree(state) !== syntaxTree(startState)) {
        this.decorations = decorate(view);
      }
    }
  }, { decorations: plugin => plugin.decorations });
}
