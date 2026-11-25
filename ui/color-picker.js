"use strict";

function normalizePickerHex(value) {
  let digits = value.trim().replace(/^#/, "").toUpperCase();
  if (!/^(?:[0-9A-F]{3,4}|[0-9A-F]{6}|[0-9A-F]{8})$/.test(digits)) return null;
  if (digits.length <= 4) digits = [...digits].map(char => char.repeat(2)).join("");
  return "#" + digits;
}

function hexToPickerColor(hex) {
  const [r, g, b] = hex.slice(1, 7).match(/../g).map(value => parseInt(value, 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta) {
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = 2 + (b - r) / delta;
    else hue = 4 + (r - g) / delta;
  }
  return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max : 0, value: max, alpha: hex.slice(7) };
}

function pickerColorToHex({ hue, saturation, value, alpha }) {
  const channel = offset => {
    const phase = (offset + hue / 60) % 6;
    const level = value - value * saturation * Math.max(0, Math.min(phase, 4 - phase, 1));
    return Math.round(level * 255).toString(16).padStart(2, "0").toUpperCase();
  };
  return "#" + channel(5) + channel(3) + channel(1) + alpha;
}

const colorDialog = document.getElementById("lab-color-dialog");
const colorField = document.getElementById("lab-color-field");
const colorMarker = document.getElementById("lab-color-marker");
const colorHue = document.getElementById("lab-color-hue");
const colorHex = document.getElementById("lab-color-hex");
const colorSample = document.getElementById("lab-color-sample");
let pickerColor;
let applyPickedColor;

function renderPicker(hex, updateInput) {
  colorField.style.setProperty("--picker-hue", `hsl(${pickerColor.hue} 100% 50%)`);
  colorMarker.style.left = `${pickerColor.saturation * 100}%`;
  colorMarker.style.top = `${(1 - pickerColor.value) * 100}%`;
  colorHue.value = Math.min(Math.round(pickerColor.hue), 359);
  colorSample.style.backgroundColor = hex;
  if (updateInput) colorHex.value = hex;
}

function openStudioColorPicker(value, apply) {
  const hex = normalizePickerHex(value) ?? "#9A45FF";
  pickerColor = hexToPickerColor(hex);
  applyPickedColor = apply;
  renderPicker(hex, true);
  colorDialog.showModal();
  colorHex.focus();
  colorHex.select();
}

colorHex.addEventListener("input", () => {
  const hex = normalizePickerHex(colorHex.value);
  if (!hex) return;
  pickerColor = hexToPickerColor(hex);
  renderPicker(hex, false);
});

colorHue.addEventListener("input", () => {
  pickerColor.hue = Number(colorHue.value);
  renderPicker(pickerColorToHex(pickerColor), true);
});

const colorClamp = (value) => Math.max(0, Math.min(1, value));
function sampleColorField(event) {
  const box = colorField.getBoundingClientRect();
  pickerColor.saturation = colorClamp((event.clientX - box.left) / box.width);
  pickerColor.value = 1 - colorClamp((event.clientY - box.top) / box.height);
  renderPicker(pickerColorToHex(pickerColor), true);
}

colorField.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  colorField.setPointerCapture(event.pointerId);
  sampleColorField(event);
});
colorField.addEventListener("pointermove", event => {
  if (colorField.hasPointerCapture(event.pointerId)) sampleColorField(event);
});
colorField.addEventListener("keydown", event => {
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const direction = arrows[event.key];
  if (!direction) return;
  const step = event.shiftKey ? .1 : .02;
  pickerColor.saturation = colorClamp(pickerColor.saturation + direction[0] * step);
  pickerColor.value = colorClamp(pickerColor.value + direction[1] * step);
  renderPicker(pickerColorToHex(pickerColor), true);
  event.preventDefault();
});

document.getElementById("lab-color-cancel").onclick = () => colorDialog.close();
colorDialog.addEventListener("close", () => { applyPickedColor = null; });
colorDialog.querySelector("form").addEventListener("submit", event => {
  event.preventDefault();
  const hex = normalizePickerHex(colorHex.value);
  if (!hex) return;
  const apply = applyPickedColor;
  colorDialog.close();
  apply?.(hex);
});
