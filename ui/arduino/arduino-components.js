"use strict";

window.extraArduinoComponents = (() => {
  function module(label, title, category, left, right, w = 144, step = 19) {
    const h = Math.max(left.length, right.length) * step + 46;
    const bank = (names, direction) => names.map((name, i) => ({
      name, x: direction * (w / 2 + 10), y: -h / 2 + 33 + step * i,
    }));
    return {
      label, title, category, size: [w + 20, h],
      symbol: `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="8" class="schematic-board"/><path d="M ${-w / 2} ${-h / 2 + 24} H ${w / 2}"/><text x="0" y="${-h / 2 + 16}" class="schematic-board-title">${label}</text>`,
      pins: [...bank(left, -1), ...bank(right, 1)],
    };
  }
  const namedPins = (prefix, start, count) => Array.from({ length: count }, (_, i) => prefix + (start + i));
  return {
    mega: module("MEGA 2560", "Arduino Mega 2560", "boards",
      ["5V", "3V3", "GND", "VIN", ...namedPins("A", 0, 16), ...namedPins("D", 37, 17)],
      namedPins("D", 0, 37), 194, 12),
    uno_r4: module("UNO R4", "Arduino Uno R4 Minima", "boards",
      ["5V", "3V3", "GND", "VIN", ...namedPins("A", 0, 6)], namedPins("D", 0, 14), 184),
    motor: {
      label: "Moteur CC", title: "Moteur CC", category: "motors", size: [104, 62],
      symbol: '<path d="M -52 0 H -24 M 24 0 H 52 M -12 11 V -11 L 0 5 L 12 -11 V 11"/><circle r="24"/>',
      pins: [{ name: "1", x: -52, y: 0 }, { name: "2", x: 52, y: 0 }],
    },
    servo: module("SERVO", "Servomoteur", "motors", ["V+", "GND", "Signal"], []),
    l298n: module("L298N", "Pilote moteur L298N", "motors",
      ["VS", "5V", "GND", "ENA", "IN1", "IN2", "ENB", "IN3", "IN4"], ["OUT1", "OUT2", "OUT3", "OUT4"], 164),
    rgb: module("LED RGB", "LED RGB · cathode commune", "display", ["R", "G", "B"], ["K"]),
    oled: module("OLED I²C", "Écran OLED SSD1306 I²C", "display", ["VCC", "GND", "SDA", "SCL"], [], 168),
    lcd: module("LCD 1602", "Écran LCD 1602 I²C", "display", ["VCC", "GND", "SDA", "SCL"], [], 190),
    tft: module("TFT RGB", "Écran couleur ST7735 SPI", "display",
      ["VCC", "GND", "SCK", "MOSI"], ["CS", "DC", "RESET", "BL"], 168),
    neopixel: module("WS2812B", "Ruban RGB WS2812B", "display", ["5V", "GND", "DIN"], ["DOUT"], 154),
  };
})();
