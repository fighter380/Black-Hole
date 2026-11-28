import { snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

const rootKeys = {
  "package.json": ["name", "version", "description", "private", "type", "main", "exports", "scripts",
    "dependencies", "devDependencies", "peerDependencies", "engines", "workspaces", "license"],
  "tsconfig.json": ["compilerOptions", "include", "exclude", "files", "extends", "references"],
};
const values = [
  ...["true", "false", "null"].map(label => ({ label, type: "keyword" })),
  snippetCompletion("{${}}", { label: "{}", detail: "objet" }),
  snippetCompletion("[${}]", { label: "[]", detail: "tableau" }),
  snippetCompletion('"${}"', { label: '""', detail: "chaîne" }),
];

export function jsonCompletion(getPath) {
  return context => {
    const { state, pos } = context;
    const tree = syntaxTree(state);
    const node = tree.resolveInner(pos, -1);
    const word = context.matchBefore(/[\w-]+/);
    const quotedToken = context.matchBefore(/"(?:[^"\\]|\\.)*/);
    const preceding = start => state.sliceDoc(Math.max(0, start - 512), start).trimEnd();
    const quote = quotedToken && /(^|[{[:,])$/.test(preceding(quotedToken.from)) ? quotedToken : null;
    const propertyName = node.name === "PropertyName" ? node : null;
    let container = node;
    while (container && !["Object", "Array"].includes(container.name)) container = container.parent;
    const from = propertyName?.from ?? quote?.from ?? word?.from ?? pos;
    const before = preceding(from);
    const delimiter = before.at(-1);

    if (container?.name === "Object" && (delimiter === "{" || delimiter === ",")) {
      if (!context.explicit && from === pos) return null;
      const file = getPath().split(/[\\/]/).at(-1).toLowerCase();
      const keys = new Set(container.parent?.name === "JsonText" ? rootKeys[file] : []);
      const existing = new Set();
      tree.iterate({
        enter({ name, from: start, to, node: keyNode }) {
          if (name !== "PropertyName" || start === from) return;
          try {
            const key = JSON.parse(state.sliceDoc(start, to));
            if (keyNode.parent?.parent?.from === container.from) existing.add(key);
            else if (keys.size < 200) keys.add(key);
          } catch {}
        },
      });
      if (!keys.size) return null;
      const to = propertyName?.to ?? pos;
      const colon = /^\s*:/.test(state.sliceDoc(to, Math.min(to + 128, state.doc.length)));
      return {
        from, to,
        options: [...keys].filter(key => !existing.has(key)).map(key => ({
          label: quote || propertyName ? JSON.stringify(key) : key, type: "property",
          apply: JSON.stringify(key) + (colon ? "" : ": "),
        })),
      };
    }
    if (quote || ["String", "PropertyName"].includes(node.name) || (!word && !context.explicit)) return null;
    if (delimiter === ":" || (container?.name === "Array" && (delimiter === "[" || delimiter === ",")) || !before) {
      return { from, options: values };
    }
    return null;
  };
}
