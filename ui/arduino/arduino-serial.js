"use strict";

window.ArduinoSerial = {
  create(onPortChange, onPanelChange) {
    const { invoke, Channel } = window.__TAURI__.core;
    const byId = id => document.getElementById(id);
    const controls = byId("arduino-console-controls");
    const portPicker = byId("arduino-port-picker");
    const heading = byId("studio-console-heading");
    const buildOutput = byId("console-output");
    const buildTab = byId("arduino-build-tab");
    const serialTab = byId("arduino-serial-tab");
    const serialPanel = byId("arduino-serial-panel");
    const port = byId("arduino-port");
    const refresh = byId("arduino-refresh-ports");
    const baud = byId("arduino-baud");
    const connect = byId("arduino-serial-connect");
    const status = byId("arduino-serial-status");
    const output = byId("arduino-serial-output");
    const input = byId("arduino-serial-input");
    const send = byId("arduino-serial-send");
    const endings = { none: "", lf: "\n", cr: "\r", crlf: "\r\n" };
    let shown = false;
    let panel = "build";
    let phase = "off";
    let busy = false;
    let loading = false;
    let streamId = 0;
    let serialText = "";
    let repaintScheduled = false;
    let following = true;
    let serialVisible = false;

    function scrollToBottom() {
      following = true;
      output.scrollTop = output.scrollHeight;
    }

    output.addEventListener("scroll", () => {
      if (output.clientHeight) following = output.scrollHeight - output.scrollTop - output.clientHeight <= 2;
    });
    byId("arduino-serial-bottom").onclick = scrollToBottom;

    const rememberedBaud = localStorage.getItem("sbbh_serial_baud");
    if ([...baud.options].some(option => option.value === rememberedBaud)) baud.value = rememberedBaud;

    function render() {
      const serialShown = shown && panel === "serial";
      const connected = phase === "on";
      const changing = phase === "opening" || phase === "closing";
      controls.hidden = !shown;
      portPicker.hidden = !shown;
      heading.hidden = serialShown;
      buildOutput.hidden = serialShown;
      buildTab.setAttribute("aria-pressed", String(!serialShown));
      serialTab.setAttribute("aria-pressed", String(serialShown));
      serialPanel.hidden = !serialShown;
      if (serialShown && !serialVisible && following) {
        requestAnimationFrame(() => { if (following) scrollToBottom(); });
      }
      serialVisible = serialShown;
      port.disabled = phase !== "off" || loading || busy;
      refresh.disabled = phase !== "off" || loading || busy;
      baud.disabled = phase !== "off" || busy;
      connect.disabled = changing || busy || !port.value;
      connect.textContent = connected ? "Déconnecter" : "Connecter";
      input.disabled = !connected;
      send.disabled = !connected;
      onPortChange();
    }

    function setPanel(next) {
      panel = next;
      render();
      onPanelChange();
    }

    async function refreshPorts() {
      if (phase !== "off" || loading || busy) return;
      loading = true;
      render();
      const before = port.value;
      try {
        const available = await invoke("list_serial_ports");
        available.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        port.replaceChildren(new Option(available.length ? "Choisir un port" : "Aucun port détecté", ""));
        for (const entry of available) {
          port.add(new Option(entry.description ? `${entry.name} · ${entry.description}` : entry.name, entry.name));
        }
        const remembered = before || localStorage.getItem("sbbh_serial_port");
        if (available.some(entry => entry.name === remembered)) port.value = remembered;
        else if (available.length === 1) port.value = available[0].name;
        status.textContent = available.length ? "" : "Branche une carte, puis actualise la liste.";
      } catch (err) {
        status.textContent = String(err);
      } finally {
        loading = false;
        render();
      }
    }

    function append(text) {
      serialText = (serialText + text).slice(-120_000);
      if (repaintScheduled) return;
      repaintScheduled = true;
      requestAnimationFrame(() => {
        repaintScheduled = false;
        const scrollTop = output.scrollTop;
        output.textContent = serialText;
        if (output.clientHeight) {
          if (following) scrollToBottom();
          else output.scrollTop = scrollTop;
        }
      });
    }

    async function openPort() {
      if (phase !== "off" || busy || !port.value) return;
      phase = "opening";
      render();
      const id = ++streamId;
      const chosen = port.value;
      const decoder = new TextDecoder();
      const channel = new Channel();
      channel.onmessage = event => {
        if (id !== streamId) return;
        if (event.type === "data") {
          append(decoder.decode(Uint8Array.from(event.bytes), { stream: true }));
        } else if (event.type === "closed") {
          append(decoder.decode());
          if (phase === "closing") return;
          streamId++;
          phase = "off";
          status.textContent = event.error || "Déconnecté.";
          render();
        }
      };
      try {
        await invoke("serial_connect", { port: chosen, baud: Number(baud.value), output: channel });
        if (id !== streamId) return;
        phase = "on";
        status.textContent = `${chosen} connecté à ${baud.value} bauds.`;
      } catch (err) {
        if (id !== streamId) return;
        phase = "off";
        status.textContent = String(err);
      } finally {
        render();
      }
    }

    async function closePort() {
      if (phase === "off") return;
      const oldPhase = phase;
      phase = "closing";
      render();
      try {
        await invoke("serial_disconnect");
        streamId++;
        phase = "off";
        status.textContent = "Déconnecté.";
      } catch (err) {
        phase = oldPhase;
        status.textContent = String(err);
        throw err;
      } finally {
        render();
      }
    }

    port.onchange = () => {
      if (port.value) localStorage.setItem("sbbh_serial_port", port.value);
      else localStorage.removeItem("sbbh_serial_port");
      status.textContent = "";
      render();
    };
    baud.onchange = () => localStorage.setItem("sbbh_serial_baud", baud.value);
    buildTab.onclick = () => setPanel("build");
    serialTab.onclick = () => setPanel("serial");
    refresh.onclick = refreshPorts;
    connect.onclick = () => phase === "on" ? closePort().catch(() => {}) : openPort();
    byId("arduino-serial-clear").onclick = () => {
      serialText = "";
      output.textContent = "";
      following = true;
    };
    byId("arduino-serial-form").onsubmit = async event => {
      event.preventDefault();
      if (phase !== "on") return;
      const value = input.value;
      const text = value + endings[byId("arduino-serial-ending").value];
      if (!text) return;
      try {
        await invoke("serial_send", { text });
        if (input.value === value) input.value = "";
      } catch (err) {
        status.textContent = String(err);
      }
    };

    return {
      show(visible) {
        const entering = visible && !shown;
        shown = visible;
        render();
        if (entering) refreshPorts();
      },
      setPanel,
      selectedPort: () => port.value,
      canUpload: () => Boolean(port.value) && !loading && (phase === "on" || phase === "off"),
      closePort,
      setBusy(value) { busy = value; render(); },
    };
  },
};
