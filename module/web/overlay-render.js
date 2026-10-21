// Desenho do overlay de jogo, usado pela janela do overlay e pela prévia na aba Overlay (mesmo resultado nos dois).
// Estilos: "panel" (painel completo), "compact" (uma linha), "fps" (só o FPS). Temas: neon, dark, glass.
(function () {
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const n = (v, d = 0) => (isNum(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--");
  const mhz = (v) => (!isNum(v) ? "--" : v >= 1000 ? n(v / 1000, 2) + " GHz" : n(v) + " MHz");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // cores de alerta: verde tranquilo, amarelo atenção, vermelho problema
  const LV = {
    fps: (v) => (!isNum(v) ? "" : v < 30 ? "bad" : v < 60 ? "warn" : "ok"),
    cpuTemp: (v) => (!isNum(v) ? "" : v >= 90 ? "bad" : v >= 80 ? "warn" : ""),
    gpuTemp: (v) => (!isNum(v) ? "" : v >= 85 ? "bad" : v >= 77 ? "warn" : ""),
    load: (v) => (!isNum(v) ? "" : v >= 98 ? "warn" : ""),
  };
  const dur = (ms) => { const m = Math.floor(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`; };

  function spark(hist) {
    const v = hist.filter(isNum);
    if (v.length < 3) return "";
    const max = Math.max(...v) * 1.1, min = Math.max(0, Math.min(...v) * 0.85), W = 150, H = 26, span = max - min || 1;
    const pts = hist.map((x, i) => (isNum(x) ? `${((i / (hist.length - 1)) * W).toFixed(1)},${(H - ((x - min) / span) * H).toFixed(1)}` : null)).filter(Boolean);
    return `<svg class="ovx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts.join(" ")}" /></svg>`;
  }

  // snap: leitura do motor; cfg: settings.overlay; game: { name, since } do Piphin Jogos; hist: últimos FPS
  function html(snap, cfg, game, hist = []) {
    const h = (snap && snap.hw) || {}, f = (snap && snap.fps) || {}, sh = cfg.show || {}, col = cfg.colors !== false;
    const c = (kind, v) => (col ? LV[kind](v) : "");
    const t = (v, kind) => (isNum(v) ? `<span class="ovx-t ${c(kind, v)}">${n(v)}°</span>` : "");
    const style = cfg.style || "panel";
    const root = (inner) => `<div class="ovx ovx-s-${style} ovx-${cfg.theme || "neon"}">${inner}</div>`;

    if (style === "fps") return root(`<b class="ovx-big ${c("fps", f.fps)}">${isNum(f.fps) ? n(f.fps) : "--"}</b><span class="ovx-unit">FPS</span>`);

    if (style === "compact") {
      const parts = [];
      if (sh.fps) parts.push(`<span><b class="ovx-fps ${c("fps", f.fps)}">${n(f.fps)}</b> FPS</span>`);
      if (sh.frameTime) parts.push(`<span><i>1%</i> ${n(f.low1)}</span>`);
      if (sh.cpu) parts.push(`<span><i>CPU</i> ${n(h.cpuLoad)}% ${t(h.cpuTemp, "cpuTemp")}</span>`);
      if (sh.gpu) parts.push(`<span><i>GPU</i> <span class="${c("load", h.gpuLoad)}">${n(h.gpuLoad)}%</span> ${t(h.gpuTemp, "gpuTemp")}</span>`);
      if (sh.vram && isNum(h.vramUsedMb)) parts.push(`<span><i>VRAM</i> ${n(h.vramUsedMb / 1024, 1)}G</span>`);
      if (sh.ram) parts.push(`<span><i>RAM</i> ${n(h.ramUsedGb, 1)}G</span>`);
      if (sh.power && (isNum(h.cpuPower) || isNum(h.gpuPower))) parts.push(`<span><i>W</i> ${n((h.cpuPower || 0) + (h.gpuPower || 0))}</span>`);
      if (sh.clock) parts.push(`<span>${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>`);
      return root(parts.join(`<em class="ovx-sep"></em>`) || "InfoHardware");
    }

    const rows = [];
    if (sh.game && game) rows.push(`<div class="ovx-game"><span>${esc(game.name)}</span><em>${dur(Date.now() - Date.parse(game.since))}</em></div>`);
    if (sh.fps) rows.push(`<div class="ovx-head"><div><b class="ovx-fps ${c("fps", f.fps)}">${isNum(f.fps) ? n(f.fps) : "--"}</b><span class="ovx-unit">FPS</span></div>${cfg.graph !== false ? spark(hist) : ""}</div>`);
    const row = (k, v, cls = "") => `<div class="ovx-r ${cls}"><span class="ovx-k">${k}</span><span class="ovx-v">${v}</span></div>`;
    if (sh.frameTime) rows.push(row("FT", `${isNum(f.frameTime) ? n(f.frameTime, 1) + " ms" : "--"} <span class="ovx-dim">1% ${n(f.low1)}</span>`));
    const hotC = c("cpuTemp", h.cpuTemp), hotG = c("gpuTemp", h.gpuTemp);
    if (sh.cpu) rows.push(row("CPU", `${n(h.cpuLoad)}% ${t(h.cpuTemp, "cpuTemp")}`, hotC === "bad" ? "ovx-alert" : ""));
    if (sh.gpu) rows.push(row("GPU", `<span class="${c("load", h.gpuLoad)}">${n(h.gpuLoad)}%</span> ${t(h.gpuTemp, "gpuTemp")}`, hotG === "bad" ? "ovx-alert" : ""));
    if (sh.vram && isNum(h.vramUsedMb)) rows.push(row("VRAM", `${n(h.vramUsedMb / 1024, 1)} GB${isNum(h.vramTotalMb) ? ` <span class="ovx-dim">/ ${n(h.vramTotalMb / 1024, 0)}</span>` : ""}`));
    if (sh.ram) rows.push(row("RAM", `${n(h.ramUsedGb, 1)} GB`));
    if (sh.power && (isNum(h.cpuPower) || isNum(h.gpuPower))) rows.push(row("W", `${n(h.cpuPower)} <span class="ovx-dim">CPU</span> ${n(h.gpuPower)} <span class="ovx-dim">GPU</span>`));
    if (sh.clocks) rows.push(row("MHz", `${mhz(h.cpuClock)} <span class="ovx-dim">/</span> ${mhz(h.gpuClock)}`));
    if (sh.clock) rows.push(row("⏱", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })));
    return root(rows.join("") || `<span class="ovx-dim">InfoHardware</span>`);
  }
  window.OverlayRender = { html };
})();
