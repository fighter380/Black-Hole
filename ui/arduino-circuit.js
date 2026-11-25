"use strict";

window.ArduinoCircuit = {
  analyze({ parts, wires }) {
    const errors = [];
    const warnings = [];
    const leds = parts.filter(part => part.kind === "led");
    const boards = parts.filter(part => part.kind === "uno");
    if (boards.length !== 1) {
      return { fatal: true, errors: ["Le schéma doit contenir une seule Arduino Uno."], warnings, leds: [] };
    }
    const board = boards[0];
    const key = (part, pin) => JSON.stringify([part, pin]);
    const parent = new Map();
    function net(node) {
      if (!parent.has(node)) parent.set(node, node);
      let root = node;
      while (parent.get(root) !== root) root = parent.get(root);
      let current = node;
      while (parent.get(current) !== current) {
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
      }
      return root;
    }
    function join(a, b) { parent.set(net(a), net(b)); }
    for (const { from, to } of wires) join(key(from.part, from.pin), key(to.part, to.pin));
    for (const part of parts.filter(part => part.kind === "ground")) {
      join(key(board.id, "GND"), key(part.id, "GND"));
    }

    const rails = ["GND", "5V", "3V3"];
    const pins = Array.from({ length: 20 }, (_, i) => i < 14 ? "D" + i : "A" + (i - 14));
    const terminals = new Map();
    for (const name of [...rails, ...pins]) {
      const id = net(key(board.id, name));
      if (!terminals.has(id)) terminals.set(id, []);
      terminals.get(id).push(name);
    }
    let fatal = false;
    for (const names of terminals.values()) {
      const supplies = names.filter(name => rails.includes(name));
      if (supplies.length > 1) {
        errors.push(`Court-circuit direct entre ${supplies.join(" et ")}.`);
        fatal = true;
      } else if (names.length > 1) {
        warnings.push(`Broches reliées directement (${names.join(", ")}). Vérifie leur configuration dans le code.`);
      }
    }

    const resistors = new Map();
    const add = (a, b) => {
      if (!resistors.has(a)) resistors.set(a, []);
      resistors.get(a).push(b);
    };
    for (const part of parts.filter(part => part.kind === "resistor")) {
      const a = net(key(part.id, "1")), b = net(key(part.id, "2"));
      if (/^\s*0+(?:[.,]0+)?\s*(?:Ω|ohms?)?\s*$/i.test(part.label)) {
        warnings.push("Une résistance de 0 Ω ne limite pas le courant.");
      } else if (a !== b) {
        add(a, b);
        add(b, a);
      }
    }

    function destinations(start, blocked) {
      const queue = [start];
      const visited = new Set([start, blocked]);
      const reached = [];
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        if (terminals.has(node)) {
          reached.push(...terminals.get(node).map(name => ({ name, resistor: node !== start })));
          continue;
        }
        for (const next of resistors.get(node) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      return reached;
    }

    if (parts.some(part => ["button", "capacitor", "pot"].includes(part.kind))) {
      warnings.push("Les boutons, condensateurs et potentiomètres restent dessinés. Leurs effets électriques ne sont pas simulés.");
    }
    const supported = [];
    for (const [i, part] of leds.entries()) {
      const label = `LED ${i + 1}${part.label && part.label !== "LED" ? ` (${part.label})` : ""}`;
      const anode = net(key(part.id, "A")), cathode = net(key(part.id, "K"));
      const a = destinations(anode, cathode), k = destinations(cathode, anode);
      if (anode === cathode) errors.push(`${label} — anode et cathode reliées ensemble.`);
      else if (!a.length || !k.length) errors.push(`${label} — circuit ouvert. Relie A et K à l’Arduino via les fils du montage.`);
      else if (a.length !== 1 || k.length !== 1) errors.push(`${label} — plusieurs chemins d’alimentation détectés.`);
      else if (a[0].name === k[0].name) errors.push(`${label} — les deux extrémités reviennent à la même broche.`);
      else if (a[0].name === "GND" || ["5V", "3V3"].includes(k[0].name)) errors.push(`${label} — polarité probablement inversée. A doit être du côté positif.`);
      else if (!a[0].resistor && !k[0].resistor) errors.push(`${label} — ajoute une résistance en série, par exemple 220 Ω.`);
      else supported.push({ id: part.id, anode: a[0].name, cathode: k[0].name });
    }
    return { fatal, errors, warnings, leds: supported, boardId: board.id };
  },
};
