import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const libDir = path.dirname(require.resolve("typescript"));
const libContents = {};

async function includeLib(name) {
  if (Object.hasOwn(libContents, name)) return;
  const contents = await readFile(path.join(libDir, name), "utf8");
  libContents[name] = contents;
  for (const [, reference] of contents.matchAll(/<reference lib="([\w.]+)"/g)) {
    await includeLib(`lib.${reference}.d.ts`);
  }
}

await includeLib("lib.es2022.full.d.ts");

const result = await build({
  absWorkingDir: root,
  entryPoints: ["editor/web-editor.js", "editor/javascript-worker.js"],
  outdir: "ui/editor",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
  metafile: true,
  external: ["path"], // Used only by the VFS package's unused Node filesystem adapter.
  plugins: [{
    name: "offline-typescript-libraries",
    setup(plugin) {
      plugin.onResolve({ filter: /^sbbh:typescript-libs$/ }, ({ path }) => ({
        path, namespace: "typescript-libs",
      }));
      plugin.onLoad({ filter: /.*/, namespace: "typescript-libs" }, () => ({
        contents: "export default " + JSON.stringify(libContents),
      }));
    },
  }],
});

const dependencies = new Set();
for (const source of Object.keys(result.metafile.inputs)) {
  const match = source.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) dependencies.add(match[1]);
}
const licenses = [];
for (const name of [...dependencies].sort()) {
  const dir = path.join(root, "node_modules", name);
  const entries = await readdir(dir);
  const notices = entries.filter(entry => /^(?:license|notice|thirdpartynotices)(?:\.|$)/i.test(entry));
  for (const entry of notices) {
    const contents = await readFile(path.join(dir, entry), "utf8");
    licenses.push(`===== ${name} / ${entry} =====\n\n${contents.trim()}`);
  }
}
await writeFile(path.join(root, "ui/editor/THIRD-PARTY-LICENSES.txt"), licenses.join("\n\n") + "\n");
