import {
  avrInstruction, CPU, AVRIOPort, AVRTimer, AVRUSART, PinState,
  portBConfig, portCConfig, portDConfig, timer0Config, timer1Config, timer2Config, usart0Config,
} from "avr8js";

function readFirmware(hex) {
  const flash = new Uint8Array(32768).fill(0xff);
  let upper = 0;
  let written = 0;
  for (const line of hex.trim().split(/\r?\n/)) {
    if (!/^:(?:[0-9a-f]{2}){5,}$/i.test(line)) throw new Error("Firmware Intel HEX illisible.");
    const bytes = line.slice(1).match(/../g).map(pair => parseInt(pair, 16));
    const [count, high, low, type] = bytes;
    if (bytes.length !== count + 5 || bytes.reduce((sum, byte) => sum + byte, 0) % 256) {
      throw new Error("Enregistrement Intel HEX invalide.");
    }
    if (type === 1) {
      if (written) return new Uint16Array(flash.buffer);
      break;
    }
    if (type === 0) {
      const start = upper + (high << 8) + low;
      if (start + count > flash.length) throw new Error("Le firmware dépasse la mémoire de l’Uno.");
      flash.set(bytes.slice(4, -1), start);
      written += count;
    } else if (type === 2 || type === 4) {
      if (count !== 2) throw new Error("Adresse Intel HEX invalide.");
      upper = ((bytes[4] << 8) + bytes[5]) * (type === 2 ? 16 : 65536);
    }
  }
  throw new Error("Firmware Intel HEX vide ou incomplet.");
}

self.onmessage = ({ data: { hex, leds, boardId } }) => {
  try {
    const cpu = new CPU(readFirmware(hex), 2048);
    for (const config of [timer0Config, timer1Config, timer2Config]) new AVRTimer(cpu, config);
    const d = new AVRIOPort(cpu, portDConfig);
    const b = new AVRIOPort(cpu, portBConfig);
    const c = new AVRIOPort(cpu, portCConfig);
    new AVRUSART(cpu, usart0Config, 16_000_000);
    const read = name => {
      if (name === "GND") return PinState.Low;
      if (name === "5V" || name === "3V3") return PinState.High;
      const pin = Number(name.slice(1));
      return name.startsWith("A") ? c.pinState(pin) : pin < 8 ? d.pinState(pin) : b.pinState(pin - 8);
    };
    const checks = [
      [boardId, () => read("D13") === PinState.High],
      ...leds.map(led => [led.id, () => read(led.anode) === PinState.High && read(led.cathode) === PinState.Low]),
    ];

    let previous = performance.now();
    let last = "";
    self.postMessage({ type: "ready" });
    setInterval(() => {
      try {
        const now = performance.now();
        const duration = Math.min(25, now - previous);
        previous = now;
        const until = cpu.cycles + Math.floor(duration * 16_000);
        const active = new Uint32Array(checks.length);
        let samples = 0;
        while (cpu.cycles < until) {
          const step = Math.min(until, cpu.cycles + 256);
          while (cpu.cycles < step) {
            avrInstruction(cpu);
            cpu.tick();
          }
          for (let i = 0; i < checks.length; i++) if (checks[i][1]()) active[i]++;
          samples++;
        }
        const lit = checks.filter((_, i) => samples && active[i] / samples >= .08).map(([id]) => id);
        const state = JSON.stringify(lit);
        if (state !== last) {
          last = state;
          self.postMessage({ type: "leds", lit });
        }
      } catch (error) {
        self.postMessage({ type: "error", message: String(error) });
        self.close();
      }
    }, 16);
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
};
