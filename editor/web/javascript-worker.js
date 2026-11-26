import ts from "typescript";
import { createSystem, createVirtualTypeScriptEnvironment } from "@typescript/vfs";
import libraries from "sbbh:typescript-libs";

const libraryFiles = Object.entries(libraries).map(([name, text]) => ["/" + name, text]);
const options = {
  allowJs: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};
const virtualPath = path => "/project/" + path;
let environment;
let activeFile;
let previousText;

self.onmessage = ({ data: { id, path, text, pos, project } }) => {
  try {
    const file = virtualPath(path);
    if (project) {
      const sources = new Map(libraryFiles);
      const roots = project.map(([name, content]) => {
        const source = virtualPath(name);
        sources.set(source, content);
        return source;
      });
      sources.set(file, text);
      environment = createVirtualTypeScriptEnvironment(createSystem(sources), [...roots, file], ts, options);
      activeFile = file;
    } else if (activeFile === file && previousText !== text) {
      environment.updateFile(file, text);
    }
    previousText = text;

    const result = environment.languageService.getCompletionsAtPosition(file, pos, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
    });
    self.postMessage({
      id,
      span: result?.optionalReplacementSpan,
      entries: result?.entries.map(({ name, kind, insertText, replacementSpan }) => ({
        name, kind, insertText, replacementSpan,
      })) ?? [],
    });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
