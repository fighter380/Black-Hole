"use strict";

window.BlackHoleTools = (({ invoke }) => {
  const el = id => document.getElementById(id);
  const dialog = el("tools-dialog");
  const status = el("tools-status");
  const log = el("tools-log");
  const pythonBin = el("tools-python-bin");
  const packageName = el("tools-pip-name");
  const notice = el("python-package-notice");
  const installerButtons = [...dialog.querySelectorAll("[data-tool-install]")];
  const languageButtons = [...dialog.querySelectorAll("[data-language]")];
  const packages = new Map([
    ["requests", "requests"], ["PIL", "Pillow"], ["numpy", "numpy"], ["pandas", "pandas"],
    ["cv2", "opencv-python"], ["serial", "pyserial"], ["yaml", "PyYAML"], ["bs4", "beautifulsoup4"],
    ["matplotlib", "matplotlib"], ["flask", "Flask"], ["pygame", "pygame"], ["sklearn", "scikit-learn"],
    ["fastapi", "fastapi"], ["pytest", "pytest"], ["openpyxl", "openpyxl"],
  ]);
  const supported = new Set(languageButtons.map(button => button.dataset.language));
  const disabledLanguages = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem("sbbh_disabled_languages") || "[]");
    if (Array.isArray(saved)) for (const language of saved) if (supported.has(language)) disabledLanguages.add(language);
  } catch {}
  let versions;
  let busy = false;
  let request = 0;
  let probing = false;
  let missing;

  const settings = () => ({
    cliPath: localStorage.getItem("sbbh_arduino_cli") || null,
    pythonBin: localStorage.getItem("sbbh_python_bin") || null,
  });

  function paint() {
    for (const output of dialog.querySelectorAll("[data-tool-version]")) {
      const key = output.dataset.toolVersion;
      output.textContent = versions?.[key] || (probing ? "Vérification…" : "Non détecté");
    }
    for (const button of installerButtons) {
      const tool = button.dataset.toolInstall;
      button.disabled = busy || probing || Boolean(versions?.[tool]) ||
        (tool === "arduino_avr" ? !versions?.arduino_cli : !versions?.winget);
      button.textContent = versions?.[tool] ? "Détecté" : "Installer";
    }
    for (const button of languageButtons) {
      const active = !disabledLanguages.has(button.dataset.language);
      button.setAttribute("aria-pressed", String(active));
      button.textContent = active ? "Désactiver" : "Activer";
    }
    el("tools-winget").textContent = versions?.winget === false ? "WinGet n’est pas détecté. Les outils installés restent utilisables." : "";
    el("tools-refresh").disabled = busy || probing;
    el("tools-python-save").disabled = busy;
    el("tools-pip-install").disabled = busy || probing || !versions?.pip;
  }

  async function inspect() {
    const id = ++request;
    probing = true;
    paint();
    try {
      const next = await invoke("inspect_tools", settings());
      if (id === request) versions = next;
    } catch (error) {
      if (id === request) status.textContent = String(error);
    } finally {
      if (id === request) {
        probing = false;
        paint();
      }
    }
  }

  function select(tab) {
    for (const button of dialog.querySelectorAll("[data-tool-tab]")) {
      button.setAttribute("aria-pressed", String(button.dataset.toolTab === tab));
    }
    for (const section of dialog.querySelectorAll("[data-tool-section]")) section.hidden = section.dataset.toolSection !== tab;
  }

  function open(tab = "runtimes") {
    select(tab);
    pythonBin.value = settings().pythonBin || "";
    if (!dialog.open) dialog.showModal();
    inspect();
  }

  async function install(command, params, label) {
    if (busy) return;
    busy = true;
    status.textContent = `Installation de ${label}…`;
    log.hidden = true;
    paint();
    try {
      const details = await invoke(command, params);
      status.textContent = command === "install_python_package"
        ? `${label} installé. Tu peux relancer ton script.`
        : `${label} installé. Redémarre Black Hole si le nouvel outil reste non détecté.`;
      log.textContent = details || "";
      log.hidden = !details;
      if (command === "install_python_package") {
        missing = null;
        notice.hidden = true;
        el("tools-python-hint").hidden = true;
      }
    } catch (error) {
      status.textContent = `Installation de ${label} impossible.`;
      log.textContent = String(error);
      log.hidden = false;
    } finally {
      busy = false;
      await inspect();
    }
  }

  for (const tab of dialog.querySelectorAll("[data-tool-tab]")) tab.onclick = () => select(tab.dataset.toolTab);
  for (const button of installerButtons) button.onclick = () => {
    const label = button.closest(".lab-tool-row").querySelector("strong").textContent;
    install("install_tool", { tool: button.dataset.toolInstall, cliPath: settings().cliPath }, label);
  };
  for (const button of languageButtons) button.onclick = () => {
    const language = button.dataset.language;
    if (!disabledLanguages.delete(language)) disabledLanguages.add(language);
    localStorage.setItem("sbbh_disabled_languages", JSON.stringify([...disabledLanguages]));
    document.dispatchEvent(new Event("black-hole-language-change"));
    paint();
  };
  el("open-tools").onclick = () => open();
  el("close-tools").onclick = () => dialog.close();
  el("tools-refresh").onclick = inspect;
  el("tools-python-save").onclick = () => {
    const path = pythonBin.value.trim().replace(/^"|"$/g, "");
    if (path) localStorage.setItem("sbbh_python_bin", path);
    else localStorage.removeItem("sbbh_python_bin");
    inspect();
  };
  el("tools-pip-form").onsubmit = event => {
    event.preventDefault();
    const name = packageName.value.trim();
    if (name && versions?.pip) install("install_python_package", { package: name, pythonBin: settings().pythonBin }, name);
  };
  el("python-package-dismiss").onclick = () => { notice.hidden = true; };
  el("python-package-open").onclick = () => {
    if (!missing) return;
    const hint = el("tools-python-hint");
    hint.textContent = missing.package ? `Import manquant ${missing.module}. Paquet proposé ${missing.package}.`
      : `Import manquant ${missing.module}. Indique le nom du paquet PyPI qui fournit ce module.`;
    hint.hidden = false;
    packageName.value = missing.package || "";
    notice.hidden = true;
    open("python");
    packageName.focus();
  };

  return {
    get busy() { return busy; },
    get isOpen() { return dialog.open; },
    language(extension) { return supported.has(extension) && !disabledLanguages.has(extension) ? extension : null; },
    reportPythonError(stderr) {
      const module = stderr.match(/^ModuleNotFoundError: No module named ['"]([A-Za-z_]\w*)['"]/m)?.[1];
      if (!module) return;
      missing = { module, package: packages.get(module) };
      el("python-package-message").textContent = missing.package
        ? `Python ne trouve pas « ${module} ». Tu peux installer ${missing.package} dans Outils.`
        : `Python ne trouve pas « ${module} ».`;
      notice.hidden = false;
    },
  };
})(window.__TAURI__.core);
