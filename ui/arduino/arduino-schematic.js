"use strict";

(() => {
  const { invoke } = window.__TAURI__.core;
  const el = id => document.getElementById(id);
  const panel = el("arduino-schematic");
  const toggle = el("btn-arduino-schematic");
  const canvas = el("schematic-canvas");
  const notice = el("schematic-status");
  const diagnostics = el("schematic-diagnostics");
  const simulate = el("schematic-simulate");
  const editLabel = el("schematic-label");
  const save = el("schematic-save");
  const rotate = el("schematic-rotate");
  const remove = el("schematic-remove");
  const componentPicker = el("schematic-components");
  const categoryPicker = el("schematic-category");
  const grid = el("schematic-grid");
  const drawing = el("schematic-drawing");
  const width = 1000;
  const height = 580;

  const pin = (name, x, y) => ({ name, x, y });
  const leftPins = ["5V", "3V3", "GND", "VIN", "A0", "A1", "A2", "A3", "A4", "A5"];
  const types = {
    uno: {
      label: "Arduino Uno",
      title: "Arduino Uno",
      size: [224, 296],
      symbol: '<rect x="-96" y="-143" width="192" height="286" rx="12" class="schematic-board"/><path d="M -96 -111 H 96"/><text x="0" y="-123" class="schematic-board-title">UNO</text>',
      pins: [
        ...leftPins.map((name, index) => pin(name, -112, -89 + 24 * index)),
        ...Array.from({ length: 14 }, (_, index) => pin("D" + index, 112, -99 + 17.5 * index)),
      ],
    },
    led: {
      label: "LED", title: "LED", size: [104, 56],
      symbol: '<path d="M -49 0 H -15 M 15 0 H 49 M -15 -12 L 15 0 L -15 12 Z M 15 -12 V 12 M 1 -16 L 13 -27 M 13 -16 L 25 -27 M 7 -27 H 13 V -21 M 19 -27 H 25 V -21"/>',
      pins: [pin("A", -52, 0), pin("K", 52, 0)],
    },
    resistor: {
      label: "220 Ω", title: "Résistance", size: [104, 40],
      symbol: '<path d="M -49 0 H -28 M 28 0 H 49"/><rect x="-28" y="-9" width="56" height="18" rx="2"/>',
      pins: [pin("1", -52, 0), pin("2", 52, 0)],
    },
    button: {
      label: "Bouton", title: "Bouton poussoir", size: [104, 54],
      symbol: '<path d="M -49 0 H -17 M 17 0 H 49 M -19 -7 L 16 -20 M 0 -20 V -27 M -10 -27 H 10"/><circle cx="-17" r="3"/><circle cx="17" r="3"/>',
      pins: [pin("1", -52, 0), pin("2", 52, 0)],
    },
    capacitor: {
      label: "100 nF", title: "Condensateur", size: [104, 50],
      symbol: '<path d="M -49 0 H -7 M 7 0 H 49 M -7 -17 V 17 M 7 -17 V 17"/>',
      pins: [pin("1", -52, 0), pin("2", 52, 0)],
    },
    pot: {
      label: "10 kΩ", title: "Potentiomètre", size: [104, 100],
      symbol: '<path d="M -49 0 H -27 M 27 0 H 49 M 0 -46 V -11 M -6 -17 L 0 -11 L 6 -17"/><rect x="-27" y="-9" width="54" height="18" rx="2"/>',
      pins: [pin("1", -52, 0), pin("2", 0, -49), pin("3", 52, 0)],
    },
    ground: {
      label: "GND", title: "Masse", size: [62, 54],
      symbol: '<path d="M 0 -23 V 3 M -16 3 H 16 M -11 9 H 11 M -6 15 H 6"/>',
      pins: [pin("GND", 0, -26)],
    },
    ...window.extraArduinoComponents,
  };

  const ns = "http://www.w3.org/2000/svg";
  const svg = (tag, attributes = {}) => {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  };
  const uuid = () => crypto.randomUUID();
  const makePart = (kind, x, y) => ({ id: uuid(), kind, x, y, rotation: 0, label: types[kind].label });
  let project;
  let model;
  let selected = null;
  let placementKind = null;
  let pinStart = null;
  let drag = null;
  let pan = null;
  let spaceHeld = false;
  let camera = { x: 0, y: 0, width };
  let suppressCanvasClick = false;
  let dirty = false;
  let saving = false;
  let opening = false;
  let compiling = false;
  let simulationRequest = 0;
  let compileFirmware;
  let worker = null;
  let lit = new Set();

  function samePin(a, b) {
    return a?.part === b?.part && a?.pin === b?.pin;
  }

  function selectedPart() {
    return selected?.type === "part" ? model.parts.find(part => part.id === selected.id) : null;
  }

  function positionOf(endpoint, parts) {
    const part = parts.get(endpoint.part);
    const terminal = part && types[part.kind].pins.find(pin => pin.name === endpoint.pin);
    if (!terminal) return null;
    const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][part.rotation / 90];
    const dx = Math.sign(terminal.x);
    const dy = dx === 0 ? Math.sign(terminal.y) : 0;
    return {
      x: part.x + terminal.x * cos - terminal.y * sin,
      y: part.y + terminal.x * sin + terminal.y * cos,
      dx: dx * cos - dy * sin,
      dy: dx * sin + dy * cos,
    };
  }

  function partBounds(part) {
    const [w, h] = types[part.kind].size;
    const rotated = part.rotation % 180 !== 0;
    const halfWidth = (rotated ? h : w) / 2 + 8;
    const halfHeight = (rotated ? w : h) / 2 + 8;
    return { left: part.x - halfWidth, right: part.x + halfWidth,
      top: part.y - halfHeight, bottom: part.y + halfHeight };
  }

  function crosses(a, b, box) {
    if (a.y === b.y) {
      return a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
    }
    return a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
  }

  function wirePath(from, to, bounds) {
    const tail = pin => ({ x: pin.x + pin.dx * 20, y: pin.y + pin.dy * 20 });
    const a = tail(from);
    const b = tail(to);
    const xs = new Set([a.x, b.x, Math.round((a.x + b.x) / 2), ...bounds.flatMap(box => [box.left, box.right])]);
    const ys = new Set([a.y, b.y, Math.round((a.y + b.y) / 2), ...bounds.flatMap(box => [box.top, box.bottom])]);
    let best = null;
    let lowest = Infinity;

    function consider(one, two) {
      const route = [a, one, two, b].filter((point, index, points) =>
        index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
      let score = route.length;
      for (let i = 1; i < route.length; i++) {
        const start = route[i - 1], end = route[i];
        score += Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
        for (const box of bounds) if (crosses(start, end, box)) score += 10_000;
      }
      if (score < lowest) {
        lowest = score;
        best = route;
      }
    }

    for (const x of xs) consider({ x, y: a.y }, { x, y: b.y });
    for (const y of ys) consider({ x: a.x, y }, { x: b.x, y });
    return `M ${[from, ...best, to].map(point => `${point.x} ${point.y}`).join(" L ")}`;
  }

  function message(text) {
    notice.textContent = text;
  }

  function renderControls() {
    const part = selectedPart();
    rotate.disabled = !part;
    remove.disabled = !selected;
    editLabel.disabled = !part;
    editLabel.value = part?.label ?? "";
    save.disabled = saving || !dirty;
    simulate.disabled = compiling;
    simulate.textContent = worker ? "Arrêter la simulation" : "Compiler et simuler";
  }

  function selectComponent(kind) {
    placementKind = kind;
    if (kind) pinStart = null;
    canvas.classList.toggle("is-placing", Boolean(kind));
    for (const button of componentPicker.children) {
      button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
    }
  }

  function placeComponent({ x, y }) {
    const kind = placementKind;
    const part = makePart(kind, snap(x), snap(y));
    selectComponent(null);
    model.parts.push(part);
    selected = { type: "part", id: part.id };
    changed(`${types[kind].title} ajouté.`);
  }

  for (const [kind, type] of Object.entries(types)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lab-btn";
    button.dataset.kind = kind;
    button.dataset.category = type.category ?? (kind === "uno" ? "boards" : "basics");
    button.textContent = type.title;
    button.setAttribute("aria-pressed", "false");
    button.onclick = () => {
      selectComponent(placementKind === kind ? null : kind);
      renderCanvas();
      message(placementKind ? `${type.title} · Clique sur le schéma pour le placer. Entrée le place au centre.`
        : "Placement annulé.");
      if (placementKind) canvas.focus();
    };
    componentPicker.append(button);
  }
  categoryPicker.onchange = () => {
    for (const button of componentPicker.children) {
      button.hidden = categoryPicker.value !== "all" && button.dataset.category !== categoryPicker.value;
    }
    if (placementKind && ![...componentPicker.children].some(button => !button.hidden && button.dataset.kind === placementKind)) {
      selectComponent(null);
      message("Placement annulé.");
    }
  };

  function updateLights() {
    for (const marker of canvas.querySelectorAll("[data-sim-light]")) {
      marker.classList.toggle("is-lit", lit.has(marker.dataset.simLight));
    }
  }

  function stopSimulation() {
    if (!worker) return;
    worker.terminate();
    worker = null;
    lit = new Set();
    updateLights();
    renderControls();
  }

  function verifyCircuit() {
    const result = ArduinoCircuit.analyze(model);
    const rows = [...result.errors.map(text => [text, "error"]), ...result.warnings.map(text => [text, "warning"])];
    diagnostics.replaceChildren(...rows.map(([text, severity]) => {
      const item = document.createElement("li");
      item.dataset.severity = severity;
      item.textContent = text;
      return item;
    }));
    diagnostics.hidden = !rows.length;
    return result;
  }

  el("schematic-verify").onclick = () => {
    const result = verifyCircuit();
    if (result.fatal) message("La vérification du câblage est indisponible pour ce schéma.");
    else if (result.errors.length) message("Le câblage des LED comporte des erreurs.");
    else if (result.leds.length) message("Aucune erreur détectée dans le câblage des LED.");
    else message("Aucune LED externe à vérifier. Tu peux tester la LED intégrée de l’Uno.");
  };

  simulate.onclick = async () => {
    if (worker) {
      stopSimulation();
      message("Simulation arrêtée.");
      return;
    }
    if (compiling) return;
    const request = ++simulationRequest;
    compiling = true;
    renderControls();
    message("Compilation du croquis…");
    try {
      const hex = await compileFirmware();
      if (request !== simulationRequest || panel.hidden) return;
      const circuit = verifyCircuit();
      if (circuit.fatal) {
        message("Croquis compilé. Corrige le câblage pour lancer la simulation.");
        return;
      }
      worker = new Worker(new URL("./editor/arduino-worker.js", document.baseURI));
      const current = worker;
      worker.onmessage = ({ data }) => {
        if (worker !== current) return;
        if (data.type === "error") {
          stopSimulation();
          message(data.message);
        } else if (data.type === "ready") {
          message(circuit.errors.length ? "Simulation en cours. Corrige les LED signalées pour les tester."
            : "Simulation en cours · LED intégrée sur D13.");
        } else if (data.type === "leds") {
          lit = new Set(data.lit);
          updateLights();
        }
      };
      worker.onerror = () => { stopSimulation(); message("Le moteur de simulation a rencontré une erreur."); };
      worker.postMessage({ hex, leds: circuit.leds, boardId: circuit.boardId });
    } catch (error) {
      if (request === simulationRequest && !panel.hidden) message(error.message || String(error));
    } finally {
      compiling = false;
      renderControls();
    }
  };

  function renderCanvas() {
    const content = document.createDocumentFragment();
    const parts = new Map(model.parts.map(part => [part.id, part]));
    const bounds = model.parts.map(partBounds);
    for (const wire of model.wires) {
      const from = positionOf(wire.from, parts);
      const to = positionOf(wire.to, parts);
      if (!from || !to) continue;
      const d = wirePath(from, to, bounds);
      const group = svg("g", { class: "schematic-wire", "data-wire": wire.id,
        "data-selected": selected?.id === wire.id });
      group.append(svg("path", { d, class: "schematic-wire-line" }),
        svg("path", { d, class: "schematic-wire-hit", tabindex: 0, role: "button",
          "aria-label": `Fil ${wire.from.pin} vers ${wire.to.pin}` }));
      content.append(group);
    }
    for (const part of model.parts) {
      const type = types[part.kind];
      const group = svg("g", { transform: `translate(${part.x} ${part.y})`, class: "schematic-part",
        "data-selected": selected?.id === part.id });
      const symbol = svg("g", { transform: `rotate(${part.rotation})`, "data-part": part.id });
      const [w, h] = type.size;
      const hit = svg("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 6,
        class: "schematic-part-hit", tabindex: 0, role: "button", "aria-label": type.title });
      const artwork = svg("g", { class: "schematic-symbol" });
      artwork.innerHTML = type.symbol;
      symbol.append(hit, artwork);
      if (part.kind === "uno" || part.kind === "led") {
        const onboard = part.kind === "uno";
        symbol.append(svg("circle", { cx: onboard ? 62 : 0, cy: onboard ? -70 : 0,
          r: onboard ? 5 : 10, class: "schematic-light", "data-sim-light": part.id }));
        if (onboard) {
          const ledLabel = svg("text", { x: 62, y: -56, class: "schematic-part-label" });
          ledLabel.textContent = "L";
          symbol.append(ledLabel);
        }
      }
      for (const terminal of type.pins) {
        const label = `${part.label || type.title} · ${terminal.name}`;
        const endpoint = { part: part.id, pin: terminal.name };
        const pinGroup = svg("g", { class: "schematic-pin", "data-pin": terminal.name,
          "data-pin-part": part.id, "data-start": samePin(pinStart, endpoint),
          tabindex: 0, role: "button", "aria-label": label });
        const title = svg("title");
        title.textContent = label;
        const pinText = svg("text", {
          x: terminal.x + (terminal.x < 0 ? 10 : terminal.x > 0 ? -10 : 10),
          y: terminal.y + (part.kind === "uno" ? 3 : -9),
          "text-anchor": terminal.x > 0 ? "end" : "start",
        });
        pinText.textContent = terminal.name;
        pinGroup.append(title, pinText, svg("circle", { cx: terminal.x, cy: terminal.y, r: 5 }),
          svg("circle", { cx: terminal.x, cy: terminal.y, r: 10, class: "schematic-pin-hit" }));
        symbol.append(pinGroup);
      }
      group.append(symbol);
      const name = svg("text", { x: 0, y: Math.max(27, (part.rotation % 180 ? w : h) / 2 + 18), class: "schematic-part-label" });
      name.textContent = part.label || type.title;
      group.append(name);
      content.append(group);
    }
    drawing.replaceChildren(content);
    updateLights();
  }

  function select(type, id) {
    selected = id ? { type, id } : null;
    renderCanvas();
    renderControls();
  }

  function changed(text) {
    dirty = true;
    if (worker) {
      stopSimulation();
      text += " Relance la simulation pour tester le nouveau câblage.";
    }
    diagnostics.hidden = true;
    renderCanvas();
    renderControls();
    message(text);
  }

  function choosePin(element) {
    const endpoint = { part: element.dataset.pinPart, pin: element.dataset.pin };
    if (!pinStart || samePin(pinStart, endpoint)) {
      pinStart = samePin(pinStart, endpoint) ? null : endpoint;
      renderCanvas();
      message(pinStart ? `Broche ${endpoint.pin} sélectionnée. Clique sur l’autre extrémité du fil.`
        : "Choisis une broche pour commencer un fil.");
      return;
    }
    const start = pinStart;
    pinStart = null;
    const exists = model.wires.some(wire => (samePin(wire.from, start) && samePin(wire.to, endpoint))
      || (samePin(wire.from, endpoint) && samePin(wire.to, start)));
    if (exists) {
      renderCanvas();
      message("Ces deux broches sont déjà reliées.");
      return;
    }
    const id = uuid();
    model.wires.push({ id, from: start, to: endpoint });
    selected = { type: "wire", id };
    changed("Fil ajouté.");
  }

  function point(event) {
    const matrix = canvas.getScreenCTM();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }

  function snap(value) {
    return Math.max(-200_000, Math.min(200_000, Math.round(value / 5) * 5));
  }

  const cameraHeight = () => camera.width * height / width;
  const cameraCenter = () => ({ x: camera.x + camera.width / 2, y: camera.y + cameraHeight() / 2 });
  function paintCamera() {
    const h = cameraHeight();
    canvas.setAttribute("viewBox", `${camera.x} ${camera.y} ${camera.width} ${h}`);
    for (const [name, value] of Object.entries({ x: camera.x, y: camera.y, width: camera.width, height: h })) {
      grid.setAttribute(name, value);
    }
    el("schematic-zoom").value = `${Math.round(100 * width / camera.width)} %`;
  }

  function zoom(factor, anchor = cameraCenter()) {
    const next = Math.max(220, Math.min(450_000, camera.width * factor));
    const scale = next / camera.width;
    camera = { x: anchor.x + (camera.x - anchor.x) * scale,
      y: anchor.y + (camera.y - anchor.y) * scale, width: next };
    paintCamera();
  }

  function fitDiagram() {
    if (!model.parts.length) {
      camera = { x: 0, y: 0, width };
    } else {
      const boxes = model.parts.map(partBounds);
      const left = Math.min(...boxes.map(box => box.left));
      const right = Math.max(...boxes.map(box => box.right));
      const top = Math.min(...boxes.map(box => box.top));
      const bottom = Math.max(...boxes.map(box => box.bottom));
      const w = Math.max(360, right - left + 125, (bottom - top + 105) * width / height);
      camera = { x: (left + right - w) / 2, y: (top + bottom - w * height / width) / 2, width: w };
    }
    paintCamera();
  }
  el("schematic-zoom-in").onclick = () => zoom(0.8);
  el("schematic-zoom-out").onclick = () => zoom(1.25);
  el("schematic-fit").onclick = fitDiagram;
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.88 : 1.14, point(event));
  }, { passive: false });

  canvas.addEventListener("pointerdown", event => {
    suppressCanvasClick = false;
    if (event.button === 1 || (event.button === 0 && (spaceHeld || (!placementKind && (event.target === grid || event.target === canvas))))) {
      const matrix = canvas.getScreenCTM();
      pan = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, camera: { ...camera }, sx: matrix.a, sy: matrix.d };
      canvas.classList.add("is-panning");
      canvas.setPointerCapture(event.pointerId);
      if (event.button === 1) event.preventDefault();
      return;
    }
    if (placementKind || event.button !== 0 || event.target.closest("[data-pin]")) return;
    const element = event.target.closest("[data-part]");
    if (!element) return;
    const part = model.parts.find(part => part.id === element.dataset.part);
    if (!part) return;
    const cursor = point(event);
    drag = { part, id: event.pointerId, x: part.x, y: part.y, dx: part.x - cursor.x, dy: part.y - cursor.y };
    suppressCanvasClick = true;
    canvas.setPointerCapture(event.pointerId);
    select("part", part.id);
  });

  canvas.addEventListener("pointermove", event => {
    if (pan?.id === event.pointerId) {
      const dx = event.clientX - pan.clientX;
      const dy = event.clientY - pan.clientY;
      if (!suppressCanvasClick && Math.hypot(dx, dy) < 4) return;
      suppressCanvasClick = true;
      camera.x = pan.camera.x - dx / pan.sx;
      camera.y = pan.camera.y - dy / pan.sy;
      paintCamera();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const cursor = point(event);
    drag.part.x = snap(cursor.x + drag.dx);
    drag.part.y = snap(cursor.y + drag.dy);
    renderCanvas();
  });
  function finishDrag(event) {
    if (pan?.id === event.pointerId) {
      pan = null;
      canvas.classList.remove("is-panning");
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.part.x !== drag.x || drag.part.y !== drag.y) changed("Composant déplacé.");
    drag = null;
  }
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);

  function activate(target) {
    const terminal = target.closest("[data-pin]");
    if (terminal) {
      choosePin(terminal);
      return;
    }
    const wire = target.closest("[data-wire]");
    if (wire) {
      select("wire", wire.dataset.wire);
      return;
    }
    const part = target.closest("[data-part]");
    if (part) {
      select("part", part.dataset.part);
    } else if (target === canvas || target === grid) {
      pinStart = null;
      select(null, null);
      message("Choisis une broche pour commencer un fil.");
    }
  }
  canvas.addEventListener("click", event => {
    if (suppressCanvasClick) return;
    if (placementKind) {
      placeComponent(point(event));
      return;
    }
    activate(event.target);
  });
  canvas.addEventListener("keydown", event => {
    if (event.key === " " && event.target === canvas && !placementKind) {
      event.preventDefault();
      spaceHeld = true;
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (placementKind) {
        placeComponent(cameraCenter());
        return;
      }
      activate(event.target);
    }
  });
  canvas.addEventListener("keyup", event => { if (event.key === " ") spaceHeld = false; });
  canvas.addEventListener("blur", () => { spaceHeld = false; });

  function removeSelected() {
    if (!selected) return;
    const { type, id } = selected;
    if (type === "part") {
      model.parts = model.parts.filter(part => part.id !== id);
      model.wires = model.wires.filter(wire => wire.from.part !== id && wire.to.part !== id);
      if (pinStart?.part === id) pinStart = null;
    } else {
      model.wires = model.wires.filter(wire => wire.id !== id);
    }
    selected = null;
    changed(type === "wire" ? "Fil supprimé." : "Composant supprimé.");
  }

  rotate.onclick = () => {
    const part = selectedPart();
    if (!part) return;
    part.rotation = (part.rotation + 90) % 360;
    changed("Composant tourné.");
  };
  remove.onclick = removeSelected;
  editLabel.oninput = () => {
    const part = selectedPart();
    if (!part) return;
    part.label = editLabel.value;
    dirty = true;
    save.disabled = saving;
    renderCanvas();
    message("Nom ou valeur modifié.");
  };

  async function saveDiagram() {
    if (!dirty || saving) return;
    saving = true;
    save.disabled = true;
    const snapshot = JSON.stringify(model);
    try {
      await invoke("save_arduino_schematic", { ...project, schematic: JSON.parse(snapshot) });
      dirty = snapshot !== JSON.stringify(model);
      message(dirty ? "Le schéma a encore des modifications en cours." : "Schéma enregistré.");
    } catch (error) {
      message(String(error));
    } finally {
      saving = false;
      save.disabled = !dirty;
    }
  }

  function hide() {
    simulationRequest++;
    selectComponent(null);
    stopSimulation();
    if (!panel.hidden && panel.contains(document.activeElement)) toggle.focus();
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  function show() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    renderCanvas();
    renderControls();
    message(dirty ? "Modifications du schéma encore à enregistrer."
      : "Ajoute des composants, puis clique sur deux broches pour les relier.");
  }

  function matches(target) {
    return Boolean(project && target && project.vaultPath === target.vaultPath && project.sketchPath === target.sketchPath);
  }

  save.onclick = saveDiagram;
  el("schematic-close").onclick = hide;
  panel.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveDiagram();
    }
    if (event.key === "Delete" && !event.target.closest("input,select")) removeSelected();
    if (event.key === "Escape") {
      event.preventDefault();
      if (placementKind) {
        selectComponent(null);
        message("Placement annulé.");
      } else if (pinStart) {
        pinStart = null;
        renderCanvas();
        message("Tracé du fil annulé.");
      } else hide();
    }
  });

  function readModel(saved) {
    if (!saved) return { version: 1, parts: [makePart("uno", 315, 265)], wires: [] };
    if (saved.version !== 1 || !Array.isArray(saved.parts) || !Array.isArray(saved.wires)) {
      throw new Error("Format de schéma inconnu.");
    }
    const parts = new Map();
    for (const part of saved.parts) {
      if (!part || !Object.hasOwn(types, part.kind) || typeof part.id !== "string" || parts.has(part.id)
        || typeof part.label !== "string" || !Number.isFinite(part.x) || !Number.isFinite(part.y)
        || ![0, 90, 180, 270].includes(part.rotation)) throw new Error("Composant de schéma illisible.");
      parts.set(part.id, part);
    }
    const wireIds = new Set();
    for (const wire of saved.wires) {
      if (!wire?.from || !wire.to || typeof wire.id !== "string" || wireIds.has(wire.id)
        || !positionOf(wire.from, parts) || !positionOf(wire.to, parts)) throw new Error("Fil de schéma illisible.");
      wireIds.add(wire.id);
    }
    return saved;
  }

  window.ArduinoSchematic = {
    get isOpen() { return !panel.hidden; },
    get hasUnsavedChanges() { return dirty || saving; },
    get isSaving() { return saving; },
    matches,
    hide,
    reset() {
      hide();
      project = model = compileFirmware = null;
      dirty = false;
    },
    sourceChanged() {
      if (panel.hidden || (!worker && !compiling)) return;
      simulationRequest++;
      stopSimulation();
      message("Code modifié. Relance la compilation pour simuler cette version.");
    },
    async open(target, loadFirmware, stillActive) {
      if (opening || saving) return;
      if (matches(target)) {
        compileFirmware = loadFirmware;
        show();
        return;
      }
      if (dirty && !confirm("Changer de schéma sans enregistrer les modifications du précédent ?")) return;
      opening = true;
      try {
        const saved = await invoke("read_arduino_schematic", target);
        if (!stillActive()) return;
        model = readModel(saved);
        if (saved) fitDiagram();
        else {
          camera = { x: 0, y: 0, width };
          paintCamera();
        }
        project = target;
        compileFirmware = loadFirmware;
        diagnostics.hidden = true;
        selected = pinStart = drag = null;
        dirty = false;
        const name = (target.sketchPath || target.vaultPath).split(/[\\/]+/).filter(Boolean).pop();
        el("schematic-project").textContent = [target.sketchPath, `${name}.ino`].filter(Boolean).join("/");
        show();
      } finally {
        opening = false;
      }
    },
  };
})();
