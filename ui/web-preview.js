"use strict";

const WEB_EXTENSIONS = new Set(["html", "htm", "css", "js"]);
const PREVIEW_ORIGIN = "https://preview.invalid";

function isWebPage(file) {
  return file.ext === "html" || file.ext === "htm";
}

function webProjectPath(path) {
  const parts = path.split("/");
  if (parts.length >= 3 && parts[0].toLowerCase() === "sites") {
    return parts.slice(0, 2).join("/");
  }
  return parts.slice(0, -1).join("/");
}

async function buildWebPreview(html, pagePath, files, readFiles) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const project = webProjectPath(pagePath);
  const projectRelative = path => project ? path.slice(project.length + 1) : path;
  const baseURL = new URL(projectRelative(pagePath).split("/").map(encodeURIComponent).join("/"), PREVIEW_ORIGIN);
  const available = new Map(files.map(file => [projectRelative(file.path), file]));
  const references = new Map();
  const missing = new Set();

  for (const element of doc.querySelectorAll('link[rel~="stylesheet" i][href], script[src]')) {
    const isStyle = element.localName === "link";
    const attr = isStyle ? "href" : "src";
    const value = element.getAttribute(attr).trim();
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;

    const url = new URL(value, baseURL);
    if (url.origin !== PREVIEW_ORIGIN) continue;
    const path = url.pathname.slice(1).split("/").map(part => {
      try { return decodeURIComponent(part); } catch { return part; }
    }).join("/");
    const file = available.get(path);
    if (file?.ext !== (isStyle ? "css" : "js")) {
      missing.add(value);
      continue;
    }
    if (!references.has(file.path)) references.set(file.path, []);
    references.get(file.path).push({ element, attr, mime: isStyle ? "text/css" : "text/javascript" });
  }

  const paths = [...references.keys()];
  const contents = paths.length ? await readFiles(paths) : [];
  paths.forEach((path, index) => {
    for (const { element, attr, mime } of references.get(path)) {
      element.setAttribute(attr, `data:${mime};charset=utf-8,${encodeURIComponent(contents[index].toWellFormed())}`);
    }
  });

  doc.querySelectorAll("base, meta[http-equiv=refresh i]").forEach(element => element.remove());
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri about:";
  const base = doc.createElement("base");
  base.href = "about:srcdoc";
  doc.head.prepend(csp, base);

  return {
    document: "<!doctype html>\n" + doc.documentElement.outerHTML,
    missing: [...missing],
  };
}
