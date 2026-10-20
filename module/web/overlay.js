// Overlay de jogo: recebe as leituras do módulo e se ajusta ao tamanho do conteúdo.
const box = document.getElementById("box");
let cfg = { scale: 1, show: { fps: true, frameTime: true, cpu: true, gpu: true, ram: true, vram: true, power: true, clocks: false, clock: false } };
const isNum = (v) => typeof v === "number" && isFinite(v);
const n = (v, d = 0) => (isNum(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "--");
const mhz = (v) => (!isNum(v) ? "--" : v >= 1000 ? n(v / 1000, 2) + " GHz" : n(v) + " MHz");
const row = (k, cls, v) => `<div class="r"><span class="k ${cls}">${k}</span><span>${v}</span></div>`;
let lastW = 0, lastH = 0;

function render(s) {
  const h = s.hw, f = s.fps || {}, sh = cfg.show, out = [];
  if (sh.fps) out.push(`<div class="r"><span class="k c">FPS</span><span class="fps">${isNum(f.fps) ? n(f.fps) : "--"}</span></div>`);
  if (sh.frameTime) out.push(row("FT", "p", `${isNum(f.frameTime) ? n(f.frameTime, 1) + " ms" : "--"} <span class="dim">1% ${isNum(f.low1) ? n(f.low1) : "--"}</span>`));
  if (sh.cpu) out.push(row("CPU", "", `${n(h.cpuLoad)}% <span class="dim">${isNum(h.cpuTemp) ? n(h.cpuTemp) + "°C" : ""}</span>`));
  if (sh.gpu) out.push(row("GPU", "c", `${n(h.gpuLoad)}% <span class="dim">${isNum(h.gpuTemp) ? n(h.gpuTemp) + "°C" : ""}</span>`));
  if (sh.vram && isNum(h.vramUsedMb)) out.push(row("VRAM", "p", `${n(h.vramUsedMb / 1024, 1)} GB`));
  if (sh.ram) out.push(row("RAM", "g", `${n(h.ramUsedGb, 1)} GB`));
  if (sh.power && (isNum(h.cpuPower) || isNum(h.gpuPower))) out.push(row("W", "o", `${n(h.cpuPower)} <span class="dim">CPU</span> ${n(h.gpuPower)} <span class="dim">GPU</span>`));
  if (sh.clocks) out.push(row("MHz", "c", `${mhz(h.cpuClock)} <span class="dim">/</span> ${mhz(h.gpuClock)}`));
  if (sh.clock) out.push(row("⏱", "", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })));
  box.innerHTML = out.join("") || `<div class="dim">InfoHardware</div>`;
  box.style.transform = `scale(${cfg.scale || 1})`;
  // a janela acompanha o tamanho do conteúdo
  const r = box.getBoundingClientRect();
  const w = Math.ceil(r.width) + 2, hh = Math.ceil(r.height) + 2;
  if (Math.abs(w - lastW) > 3 || Math.abs(hh - lastH) > 3) { lastW = w; lastH = hh; piphin.invoke("overlay-size", w, hh); }
}

let last = null;
piphin.on("config", (c) => { cfg = c; if (last) render(last); });
piphin.on("snap", (s) => { last = s; render(s); });
