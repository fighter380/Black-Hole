"use strict";

window.BlackHoleDefaults = (() => {
  const { invoke } = window.__TAURI__.core;
  const choiceKey = "sbbh_windows_defaults_choice";
  const prompt = document.getElementById("first-run-defaults");
  const yes = document.getElementById("first-run-defaults-open");
  const no = document.getElementById("first-run-defaults-skip");
  const tools = document.getElementById("tools-windows-defaults");
  const status = document.getElementById("first-run-defaults-status");

  function remember(choice) {
    localStorage.setItem(choiceKey, choice);
    prompt.hidden = true;
  }

  async function openSettings(fromPrompt) {
    yes.disabled = no.disabled = tools.disabled = true;
    try {
      await invoke("open_windows_defaults");
      if (fromPrompt || !prompt.hidden) remember("settings");
    } catch (error) {
      (fromPrompt ? status : document.getElementById("tools-status")).textContent = String(error);
    } finally {
      yes.disabled = no.disabled = tools.disabled = false;
    }
  }

  yes.onclick = () => openSettings(true);
  no.onclick = () => remember("keep");
  tools.onclick = () => openSettings(false);

  return {
    init(available) {
      tools.hidden = !available;
      prompt.hidden = !available || Boolean(localStorage.getItem(choiceKey));
    },
  };
})();
