import { snippetCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";

const functionOption = (label, args, detail = "Arduino") =>
  snippetCompletion(`${label}(${args.map(arg => "${" + arg + "}").join(", ")})`, { label, type: "function", detail });

const arduinoFunctions = [
  ["pinMode", ["pin", "mode"]], ["digitalRead", ["pin"]], ["digitalWrite", ["pin", "value"]],
  ["analogRead", ["pin"]], ["analogWrite", ["pin", "value"]], ["analogReference", ["type"]],
  ["delay", ["ms"]], ["delayMicroseconds", ["us"]], ["millis", []], ["micros", []],
  ["pulseIn", ["pin", "value"]], ["tone", ["pin", "frequency"]], ["noTone", ["pin"]],
  ["map", ["value", "fromLow", "fromHigh", "toLow", "toHigh"]],
  ["constrain", ["value", "low", "high"]], ["random", ["max"]], ["randomSeed", ["seed"]],
  ["attachInterrupt", ["interrupt", "handler", "mode"]], ["detachInterrupt", ["interrupt"]],
  ["digitalPinToInterrupt", ["pin"]], ["shiftIn", ["dataPin", "clockPin", "bitOrder"]],
  ["shiftOut", ["dataPin", "clockPin", "bitOrder", "value"]],
].map(([label, args]) => functionOption(label, args));

const constants = [
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "LED_BUILTIN", "A0", "A1", "A2", "A3", "A4", "A5",
  "CHANGE", "RISING", "FALLING", "LSBFIRST", "MSBFIRST", "DEFAULT", "INTERNAL", "EXTERNAL",
].map(label => ({ label, type: "constant", detail: "Arduino" }));
const keywords = [
  "auto", "bool", "break", "case", "char", "class", "const", "constexpr", "continue", "default", "double",
  "else", "enum", "false", "float", "for", "if", "int", "long", "namespace", "nullptr", "private", "public",
  "return", "short", "static", "struct", "switch", "true", "unsigned", "using", "void", "volatile", "while",
].map(label => ({ label, type: "keyword", detail: "C++" }));
const coreSymbols = ["Serial", "Wire", "SPI", "String", "byte", "boolean", "uint8_t", "uint16_t", "uint32_t"]
  .map(label => ({ label, type: "variable", detail: "Arduino" }));

const memberOptions = new Map([
  ["Serial", [["begin", ["baud"]], ["print", ["value"]], ["println", ["value"]], ["available", []],
    ["read", []], ["write", ["value"]], ["parseInt", []], ["flush", []], ["end", []]]],
  ["Wire", [["begin", []], ["beginTransmission", ["address"]], ["write", ["value"]],
    ["endTransmission", []], ["requestFrom", ["address", "count"]], ["available", []], ["read", []]]],
  ["SPI", [["begin", []], ["beginTransaction", ["settings"]], ["transfer", ["value"]],
    ["transfer16", ["value"]], ["endTransaction", []]]],
].map(([name, entries]) => [name, entries.map(([label, args]) => functionOption(label, args, name))]));

const snippets = [
  snippetCompletion("void setup() {\n\t${}\n}", { label: "setup", type: "function", detail: "Initialisation" }),
  snippetCompletion("void loop() {\n\t${}\n}", { label: "loop", type: "function", detail: "Boucle Arduino" }),
];
const libraries = ["Arduino.h", "Wire.h", "SPI.h", "EEPROM.h", "Servo.h", "LiquidCrystal.h"];
const identifiers = new Set(["Identifier", "TypeIdentifier", "FieldIdentifier"]);
const declarations = new Set([
  "Declaration", "ParameterDeclaration", "FieldDeclaration", "InitDeclarator", "FunctionDeclarator",
  "ArrayDeclarator", "PointerDeclarator", "ReferenceDeclarator", "PreprocDirective",
  "ClassSpecifier", "StructSpecifier", "EnumSpecifier", "TypeDefinition",
]);

function collectSymbols(state, tokenFrom) {
  const symbols = new Map();
  syntaxTree(state).iterate({
    enter({ name, from, to, node }) {
      if (!identifiers.has(name) || from === tokenFrom || !declarations.has(node.parent?.name)) return;
      if (node.parent.name === "InitDeclarator" && node.prevSibling) return;
      if (node.parent.name === "PreprocDirective" && node.prevSibling?.name !== "#define") return;
      const label = state.sliceDoc(from, to);
      if (!/^[A-Za-z_]\w*$/.test(label)) return;
      const type = node.parent.name === "FunctionDeclarator" ? "function" :
        name === "TypeIdentifier" ? "type" : "variable";
      symbols.set(label, { label, type, detail: "Dans le fichier", boost: 5 });
    },
  });
  return symbols;
}

export function arduinoCompletion(getHeaders) {
  return context => {
    const { state, pos, explicit } = context;
    const left = state.sliceDoc(state.doc.lineAt(pos).from, pos);
    const include = left.match(/^\s*#\s*include\s*([<"])([\w./-]*)$/);
    if (include) {
      const closer = include[1] === "<" ? ">" : '"';
      const hasCloser = state.sliceDoc(pos, pos + 1) === closer;
      const headers = include[1] === "<" ? libraries : getHeaders();
      return {
        from: pos - include[2].length,
        options: headers.map(label => ({ label, type: "namespace", apply: label + (hasCloser ? "" : closer) })),
        validFor: /^[\w./-]*$/,
      };
    }

    const node = syntaxTree(state).resolveInner(pos, -1);
    if (["LineComment", "BlockComment", "String", "RawString", "CharLiteral"].includes(node.name)) return null;
    const token = context.matchBefore(/[A-Za-z_]\w*/);
    const member = left.match(/\b([A-Za-z_]\w*)\s*\.\s*\w*$/);
    if (member) {
      const options = memberOptions.get(member[1]);
      return options ? { from: token && token.from > pos - member[0].length ? token.from : pos, options,
        validFor: /^\w*$/ } : null;
    }
    if (!token && !explicit) return null;

    const from = token?.from ?? pos;
    const options = collectSymbols(state, from);
    for (const option of [...arduinoFunctions, ...constants, ...keywords, ...coreSymbols, ...snippets]) {
      if (!options.has(option.label)) options.set(option.label, option);
    }
    return { from, options: [...options.values()], validFor: /^\w*$/ };
  };
}
