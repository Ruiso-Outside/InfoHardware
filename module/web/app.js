// InfoHardware dentro do Piphin Hub: Painel, Hardware, Sensores, Desempenho, Overlay e Ajustes.
// Os dados vêm do motor de sensores pelo módulo (window.piphin); o visual vem do kit do Hub (piphin://ui).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const call = async (ch, ...a) => { const r = await piphin.invoke(ch, ...a); if (!r.ok) throw new Error(r.error); return r.data; };

// ------------------------------------------------------------------ formatação (como no app)
const PT = "pt-BR";
const isNum = (v) => typeof v === "number" && isFinite(v);
const fmt = (v, d = 0) => (isNum(v) ? v.toLocaleString(PT, { minimumFractionDigits: d, maximumFractionDigits: d }) : "--");
const bytes = (b, d = 1) => {
  if (!isNum(b) || b < 0) return "--";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return fmt(b, i ? d : 0) + " " + u[i];
};
const rate = (b) => (isNum(b) ? bytes(b) + "/s" : "--");
const mhz = (v) => (!isNum(v) ? "--" : v >= 1000 ? fmt(v / 1000, 2) + " GHz" : fmt(v) + " MHz");
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const C = { purple: "#a855f7", pink: "#ff3cac", cyan: "#22d3ee", green: "#39ff88", orange: "#ffb020", red: "#ff4d6d", blue: "#5b8cff", yellow: "#f7e26b", gray: "#a495cc" };
const SENSOR_TYPES = {
  Temperature: ["Temperatura", C.pink, (v) => fmt(v, 1) + " °C"], Load: ["Uso", C.purple, (v) => fmt(v, 1) + " %"],
  Clock: ["Clock", C.cyan, mhz], Power: ["Potência", C.orange, (v) => fmt(v, 1) + " W"], Fan: ["Ventoinha", C.green, (v) => fmt(v) + " RPM"],
  Voltage: ["Tensão", C.yellow, (v) => fmt(v, 3) + " V"], Current: ["Corrente", C.yellow, (v) => fmt(v, 2) + " A"],
  Frequency: ["Frequência", C.cyan, (v) => fmt(v, 1) + " Hz"], Flow: ["Fluxo", C.blue, (v) => fmt(v, 1) + " L/h"],
  Control: ["Controle", C.green, (v) => fmt(v, 1) + " %"], Level: ["Nível", C.purple, (v) => fmt(v, 1) + " %"], Factor: ["Fator", C.gray, (v) => fmt(v, 3)],
  Data: ["Dados", C.blue, (v) => fmt(v, 2) + " GB"], SmallData: ["Dados", C.blue, (v) => fmt(v, 1) + " MB"], Throughput: ["Taxa", C.cyan, rate],
  TimeSpan: ["Tempo", C.gray, (v) => fmt(v) + " s"], Timing: ["Latência", C.gray, (v) => fmt(v, 2) + " ns"], Energy: ["Energia", C.orange, (v) => fmt(v) + " mWh"],
  Noise: ["Ruído", C.gray, (v) => fmt(v, 1) + " dBA"], Conductivity: ["Condutividade", C.gray, (v) => fmt(v, 1) + " µS/cm"], Humidity: ["Umidade", C.blue, (v) => fmt(v) + " %"],
};
const TYPE_CHIPS = ["Temperature", "Load", "Clock", "Power", "Fan", "Voltage", "Data", "Throughput"];
const HW_ICONS = { Cpu: "cpu", GpuNvidia: "monitor", GpuAmd: "monitor", GpuIntel: "monitor", Memory: "memory-stick", Motherboard: "circuit-board", SuperIO: "circuit-board",
  Storage: "hard-drive", Network: "network", Cooler: "fan", EmbeddedController: "microchip", Psu: "zap", Battery: "battery" };
const sensorFmt = (type, v) => (isNum(v) ? (SENSOR_TYPES[type] || [type, "", (x) => fmt(x, 2)])[2](v) : "--");

// ------------------------------------------------------------------ estado
let S = { engine: { status: "off" }, structure: [], snap: null, info: null, settings: null, recording: { on: false }, metrics: [] };
let tab = "dash";
let sensorFilter = "";
let sensorType = "";
let lastSession = null;
const HISTORY = 120; // 2 minutos a 1 leitura/s
const hist = {};
const SERIES = {
  cpuLoad: ["Uso da CPU", C.purple, "%", (s) => s.hw.cpuLoad], cpuTemp: ["Temperatura da CPU", C.pink, "°C", (s) => s.hw.cpuTemp],
  gpuLoad: ["Uso da GPU", C.cyan, "%", (s) => s.hw.gpuLoad], gpuTemp: ["Temperatura da GPU", C.orange, "°C", (s) => s.hw.gpuTemp],
  fps: ["FPS", C.cyan, "", (s) => s.fps && s.fps.fps], frameTime: ["Frametime", C.pink, "ms", (s) => s.fps && s.fps.frameTime],
  ramLoad: ["Uso da RAM", C.green, "%", (s) => s.hw.ramLoad], vramLoad: ["Uso da VRAM", C.pink, "%", (s) => (s.hw.vramTotalMb ? (s.hw.vramUsedMb / s.hw.vramTotalMb) * 100 : null)],
  cpuPower: ["Consumo da CPU", C.orange, "W", (s) => s.hw.cpuPower], gpuPower: ["Consumo da GPU", C.green, "W", (s) => s.hw.gpuPower],
  netDown: ["Download", C.green, "B/s", (s) => s.hw.netDown], netUp: ["Upload", C.purple, "B/s", (s) => s.hw.netUp],
  diskRead: ["Leitura do disco", C.cyan, "B/s", (s) => s.hw.diskRead], diskWrite: ["Escrita do disco", C.pink, "B/s", (s) => s.hw.diskWrite],
};
function pushHistory(s) {
  for (const [k, def] of Object.entries(SERIES)) {
    const v = def[3](s);
    const arr = hist[k] || (hist[k] = []);
    arr.push(isNum(v) ? v : NaN);
    if (arr.length > HISTORY) arr.shift();
  }
}

// ------------------------------------------------------------------ desenho
function gauge(value, max, color, label, unit, text) {
  const pct = isNum(value) ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 44, c = Math.PI * r * 1.5;
  return `<div class="gauge"><svg viewBox="0 0 120 108">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c} 999" transform="rotate(135 60 60)"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * pct} 999" transform="rotate(135 60 60)"
      style="filter: drop-shadow(0 0 5px ${color}88); transition: stroke-dasharray .5s"/></svg>
    <div class="val">${text ?? fmt(value)}<small>${unit}</small></div><div class="lbl">${esc(label)}</div></div>`;
}

function drawChart(canvas, keys) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  let max = 0;
  for (const k of keys) for (const v of hist[k] || []) if (isNum(v)) max = Math.max(max, v);
  const unit = SERIES[keys[0]][2];
  max = unit === "%" ? 100 : max > 0 ? max * 1.15 : 1;
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = Math.round((h * i) / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (const k of keys) {
    const arr = hist[k] || [];
    const color = SERIES[k][1];
    const pts = [];
    arr.forEach((v, i) => { if (isNum(v)) pts.push([w - ((arr.length - 1 - i) / (HISTORY - 1)) * w, h - (v / max) * (h - 6) - 3]); });
    if (pts.length < 2) continue;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = "round"; g.shadowColor = color; g.shadowBlur = 6; g.stroke(); g.shadowBlur = 0;
    g.lineTo(pts[pts.length - 1][0], h); g.lineTo(pts[0][0], h); g.closePath();
    const fill = g.createLinearGradient(0, 0, 0, h); fill.addColorStop(0, color + "33"); fill.addColorStop(1, color + "00");
    g.fillStyle = fill; g.fill();
  }
}
const legend = (keys) => `<div class="legend">${keys.map((k) => `<span><i style="background:${SERIES[k][1]}"></i>${esc(SERIES[k][0])}</span>`).join("")}</div>`;
const statOf = (k) => {
  const a = (hist[k] || []).filter(isNum);
  if (!a.length) return `<span class="faint">sem dados</span>`;
  const u = SERIES[k][2];
  const f = u === "B/s" ? rate : (v) => fmt(v, u === "ms" ? 1 : 0) + (u ? " " + u : "");
  return `mín <b>${f(Math.min(...a))}</b> · méd <b>${f(a.reduce((x, y) => x + y, 0) / a.length)}</b> · máx <b>${f(Math.max(...a))}</b>`;
};
const head = (title, sub, actions = "") => `<div class="p-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;

// ------------------------------------------------------------------ telas
const TABS = { dash: renderDash, hw: renderHardware, sensors: renderSensors, perf: renderPerf, overlay: renderOverlay, settings: renderSettings };

function render(fresh) {
  $$(".p-subnav [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderEngine();
  TABS[tab]();
  if (fresh) { $("#content").firstElementChild?.classList.add("p-enter"); $("#scroll").scrollTop = 0; }
}

function renderEngine() {
  const e = S.engine;
  const map = { running: ["ok", e.admin ? "Sensores completos" : "Modo limitado"], starting: ["warn", "Iniciando..."], off: ["", "Motor desligado"], error: ["err", "Erro no motor"] };
  const [cls, txt] = map[e.status] || ["", e.status];
  $("#engine").innerHTML = `<i class="dot ${cls}"></i>${esc(txt)}`;
  $("#recDot").hidden = !S.recording.on;
  let b = "";
  if (e.status === "error") b = `<div class="p-banner err"><i class="i i-circle-x"></i><span class="grow">${esc(e.error)}</span><button class="btn sm" data-act="restart"><i class="i i-rotate-ccw"></i>Tentar de novo</button></div>`;
  else if (e.status === "running" && !e.admin)
    b = `<div class="p-banner"><i class="i i-shield"></i><span class="grow"><b>Modo limitado</b> · sem temperatura da CPU, discos e FPS (${esc(e.limitedReason || "sem administrador")}).</span>
      <button class="btn sm primary" data-act="elevate"><i class="i i-shield-check"></i>Ativar modo completo</button></div>`;
  else if (e.status === "running" && !e.pawnIo && S.snap && !isNum(S.snap.hw.cpuTemp))
    b = `<div class="p-banner info"><i class="i i-info"></i><span class="grow">Temperatura e consumo da CPU precisam do driver <b>PawnIO</b>.</span><button class="btn sm" data-act="pawnio"><i class="i i-download"></i>Instalar PawnIO</button></div>`;
  if ($("#banner").innerHTML !== b) $("#banner").innerHTML = b;
}

function waiting() {
  const e = S.engine;
  if (e.status === "error") return `<div class="p-empty"><i class="i i-circle-x"></i><h3>O motor de sensores parou</h3><span>${esc(e.error)}</span></div>`;
  return `<div class="p-empty"><span class="spin" style="width:28px;height:28px"></span><h3>Lendo os sensores...</h3>
    <span>${e.status === "starting" ? "Se o Windows pedir permissão de administrador, aceite para ver temperaturas, discos e FPS." : "Aguardando a primeira leitura."}</span></div>`;
}

function renderDash() {
  const s = S.snap;
  if (!s) { $("#content").innerHTML = waiting(); return; }
  const h = s.hw, f = s.fps;
  const vramPct = h.vramTotalMb ? (h.vramUsedMb / h.vramTotalMb) * 100 : null;
  const ramTotal = (h.ramUsedGb || 0) + (h.ramAvailableGb || 0);
  const hasFps = f && isNum(f.fps);
  $("#content").innerHTML = `<div>
    <div class="dev-row">
      <div class="card dev"><div class="card-title"><span><i class="i i-cpu"></i> Processador</span><span class="num faint">${mhz(h.cpuClock)}</span></div><div class="name">${esc(h.cpuName || "--")}</div>
        <div class="gauges">${gauge(h.cpuLoad, 100, C.purple, "Uso", "%")}${gauge(h.cpuTemp, 100, C.pink, "Temperatura", "°C")}
          ${gauge(h.cpuClock, 6000, C.cyan, "Clock", "", mhz(h.cpuClock))}${gauge(h.cpuPower, 250, C.orange, "Consumo", "W", fmt(h.cpuPower, 1))}</div></div>
      <div class="card dev"><div class="card-title"><span><i class="i i-monitor"></i> Placa de vídeo</span><span class="num faint">${mhz(h.gpuClock)}</span></div><div class="name">${esc(h.gpuName || "--")}</div>
        <div class="gauges">${gauge(h.gpuLoad, 100, C.cyan, "Uso", "%")}${gauge(h.gpuTemp, 100, C.orange, "Temperatura", "°C")}
          ${gauge(vramPct, 100, C.pink, "VRAM", "%")}${gauge(h.gpuPower, 450, C.green, "Consumo", "W", fmt(h.gpuPower, 1))}</div></div>
    </div>
    <div class="row3">
      <div class="card"><div class="card-title"><span><i class="i i-gamepad-2"></i> FPS</span>${S.engine.fps ? `<span class="badge ok">ao vivo</span>` : `<span class="badge off">precisa de administrador</span>`}</div>
        <div class="fps-big ${hasFps ? "" : "off"}">${hasFps ? fmt(f.fps) : "--"}</div>
        <div class="fps-meta"><span>Frametime <b>${f && isNum(f.frameTime) ? fmt(f.frameTime, 1) + " ms" : "--"}</b></span><span>1% low <b>${f && isNum(f.low1) ? fmt(f.low1) : "--"}</b></span></div>
        <div class="fps-game"><i class="i i-app-window"></i>${esc((f && f.process) || (S.engine.fps ? "Nenhum jogo detectado" : "Ative o modo completo para medir o FPS"))}</div></div>
      <div class="card"><div class="card-title"><span><i class="i i-memory-stick"></i> Memória</span><span class="num faint">${fmt(h.ramLoad)}%</span></div><div class="kv2">
        <span>RAM</span><b>${fmt(h.ramUsedGb, 1)} / ${fmt(ramTotal, 1)} GB</b>
        <span>VRAM</span><b>${isNum(h.vramUsedMb) ? fmt(h.vramUsedMb / 1024, 1) : "--"} / ${isNum(h.vramTotalMb) ? fmt(h.vramTotalMb / 1024, 1) : "--"} GB</b>
        <span>Clock da VRAM</span><b>${mhz(h.gpuMemClock)}</b>
        <span>Hotspot da GPU</span><b>${isNum(h.gpuHotspot) ? fmt(h.gpuHotspot, 1) + " °C" : "--"}</b>
        <span>Ventoinha da GPU</span><b>${isNum(h.gpuFan) ? fmt(h.gpuFan) + " RPM" : "--"}</b></div></div>
      <div class="card"><div class="card-title"><span><i class="i i-hard-drive"></i> Disco e rede</span></div><div class="kv2">
        <span><i class="i i-arrow-down-to-line"></i>Leitura</span><b>${rate(h.diskRead)}</b><span><i class="i i-arrow-up-from-line"></i>Escrita</span><b>${rate(h.diskWrite)}</b>
        <span><i class="i i-thermometer"></i>Temp. do disco</span><b>${isNum(h.diskTemp) ? fmt(h.diskTemp) + " °C" : "--"}</b>
        <span><i class="i i-download"></i>Download</span><b>${rate(h.netDown)}</b><span><i class="i i-upload"></i>Upload</span><b>${rate(h.netUp)}</b></div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="card-title"><span><i class="i i-layers"></i> Carga por núcleo</span><span class="faint">${(h.coreLoads || []).length} núcleos lógicos</span></div>
      <div class="cores">${(h.coreLoads || []).map((v, i) => `<div class="core" title="Núcleo ${i + 1}: ${fmt(v)}%"><i style="height:${Math.max(2, Math.min(100, v))}%"></i><span>${fmt(v)}</span></div>`).join("")}</div></div>
    <div class="charts2">
      <div class="card"><div class="card-title"><span><i class="i i-activity"></i> Uso</span><span class="faint">2 min</span></div><canvas class="chart" data-keys="cpuLoad,gpuLoad"></canvas>${legend(["cpuLoad", "gpuLoad"])}</div>
      <div class="card"><div class="card-title"><span><i class="i i-thermometer"></i> Temperatura</span><span class="faint">2 min</span></div><canvas class="chart" data-keys="cpuTemp,gpuTemp"></canvas>${legend(["cpuTemp", "gpuTemp"])}</div>
    </div></div>`;
  drawCharts();
}
function drawCharts() { $$("canvas.chart").forEach((c) => drawChart(c, c.dataset.keys.split(","))); }

function renderHardware() {
  if (!S.info) { $("#content").innerHTML = `<div class="p-empty"><span class="spin" style="width:28px;height:28px"></span><h3>Lendo as informações do hardware...</h3></div>`; call("info").then((i) => { if (i) { S.info = i; render(); } }).catch(() => {}); return; }
  const sm = S.info.summary;
  $("#content").innerHTML = `<div>${head(esc(sm.computer || "Hardware"), esc([sm.cpu, sm.gpu, sm.ram].filter(Boolean).join(" · ")),
    `<button class="btn" data-act="report"><i class="i i-file-text"></i>Exportar relatório</button>`)}` +
    S.info.sections.map((sec) => `<div class="card hw-sec"><div class="head"><span class="glyph">${esc(sec.glyph || "")}</span><div><h3>${esc(sec.title)}</h3>
      ${sec.subtitle ? `<div class="sub">${esc(sec.subtitle)}</div>` : ""}</div></div>
      ${sec.groups.map((g) => `<div class="hw-group">${g.header ? `<h4>${esc(g.header)}</h4>` : ""}<dl class="kv">${g.items.map((it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.value)}</dd>`).join("")}</dl></div>`).join("")}</div>`).join("") + `</div>`;
}

function renderSensors() {
  if (!S.structure.length || !S.snap) { $("#content").innerHTML = waiting(); return; }
  const q = norm(sensorFilter.trim());
  const total = S.structure.reduce((n, g) => n + g.sensors.length, 0);
  const counts = {};
  for (const g of S.structure) for (const s of g.sensors) counts[s.type] = (counts[s.type] || 0) + 1;
  const rows = [];
  let shown = 0;
  for (const g of S.structure) {
    const list = g.sensors.filter((s) => (!sensorType || s.type === sensorType) && (!q || norm(g.name + " " + s.name + " " + (SENSOR_TYPES[s.type] || [s.type])[0]).includes(q)));
    if (!list.length) continue;
    rows.push(`<tr class="grp"><td colspan="5"><i class="i i-${HW_ICONS[g.type] || "microchip"}"></i>${esc(g.name)}</td></tr>`);
    for (const s of list) {
      shown++;
      const t = SENSOR_TYPES[s.type] || [s.type, C.gray];
      const v = S.snap.sensors[s.id] || [];
      rows.push(`<tr data-id="${esc(s.id)}"><td>${esc(s.name)}</td><td><span class="tpill" style="--c:${t[1]}">${esc(t[0])}</span></td>
        <td class="num v">${sensorFmt(s.type, v[0])}</td><td class="num mn faint">${sensorFmt(s.type, v[1])}</td><td class="num mx faint">${sensorFmt(s.type, v[2])}</td></tr>`);
    }
  }
  const focused = document.activeElement && document.activeElement.id === "sFilter";
  $("#content").innerHTML = `<div>${head("Sensores", `${shown === total ? total : `${shown} de ${total}`} sensores em ${S.structure.length} dispositivos`,
      `<label class="search"><i class="i i-search"></i><input type="search" id="sFilter" placeholder="Filtrar sensores" value="${esc(sensorFilter)}" style="width:240px"></label>
       <button class="btn" data-act="resetmm"><i class="i i-rotate-ccw"></i>Zerar mín/máx</button>`)}
    <div class="chips" style="margin-bottom:14px"><button class="chip ${!sensorType ? "active" : ""}" data-type="">Todos<span class="count">${total}</span></button>
      ${TYPE_CHIPS.filter((t) => counts[t]).map((t) => `<button class="chip type-chip ${sensorType === t ? "active" : ""}" data-type="${t}" style="--c:${SENSOR_TYPES[t][1]}"><i class="sw"></i>${SENSOR_TYPES[t][0]}<span class="count">${counts[t]}</span></button>`).join("")}</div>
    <table class="table"><thead><tr><th>Sensor</th><th>Tipo</th><th class="num">Atual</th><th class="num">Mínimo</th><th class="num">Máximo</th></tr></thead>
    <tbody>${rows.join("") || `<tr><td colspan="5" class="faint">Nenhum sensor encontrado</td></tr>`}</tbody></table></div>`;
  const inp = $("#sFilter");
  inp.oninput = (e) => { sensorFilter = e.target.value; renderSensors(); };
  if (focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}
function updateSensorValues() {
  const types = {};
  for (const g of S.structure) for (const s of g.sensors) types[s.id] = s.type;
  $$("table.table tr[data-id]").forEach((tr) => {
    const v = S.snap.sensors[tr.dataset.id] || [], t = types[tr.dataset.id];
    $(".v", tr).textContent = sensorFmt(t, v[0]); $(".mn", tr).textContent = sensorFmt(t, v[1]); $(".mx", tr).textContent = sensorFmt(t, v[2]);
  });
}

let recTimer = null;
function renderPerf() {
  const r = S.recording;
  const charts = [["Uso", "activity", ["cpuLoad", "gpuLoad"]], ["Temperatura", "thermometer", ["cpuTemp", "gpuTemp"]], ["FPS", "gamepad-2", ["fps"]], ["Frametime", "timer", ["frameTime"]],
    ["Memória", "memory-stick", ["ramLoad", "vramLoad"]], ["Consumo", "zap", ["cpuPower", "gpuPower"]], ["Rede", "network", ["netDown", "netUp"]], ["Disco", "hard-drive", ["diskRead", "diskWrite"]]];
  $("#content").innerHTML = `<div>${head("Desempenho", "Os últimos 2 minutos de cada métrica. Grave uma sessão para guardar tudo em CSV.",
      `${r.on ? `<span class="rec-time" id="recTime"></span><button class="btn danger solid" data-act="recstop"><i class="i i-square"></i>Parar</button>`
        : `<button class="btn primary" data-act="recstart"><i class="i i-circle-dot"></i>Gravar sessão</button>`}
       <button class="btn ghost" data-act="sessions" title="Abrir a pasta das sessões"><i class="i i-folder-open"></i>Sessões</button>`)}
    ${lastSession && !r.on ? `<div class="card" style="margin-bottom:14px"><div class="card-title"><span><i class="i i-circle-check"></i> Última sessão · ${lastSession.seconds} s · ${lastSession.rows} leituras</span>
      <button class="btn sm" data-act="showfile"><i class="i i-folder-open"></i>Mostrar arquivo</button></div>
      <table class="table"><thead><tr><th>Métrica</th><th class="num">Mínimo</th><th class="num">Média</th><th class="num">Máximo</th></tr></thead><tbody>
      ${lastSession.summary.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${fmt(m.min, 1)}</td><td class="num">${fmt(m.avg, 1)}</td><td class="num">${fmt(m.max, 1)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="perf-grid">${charts.map(([t, ic, keys]) => `<div class="card"><div class="card-title"><span><i class="i i-${ic}"></i> ${t}</span><span class="faint">2 min</span></div>
      <canvas class="chart" data-keys="${keys.join(",")}"></canvas>${legend(keys)}<div class="stat">${keys.map((k) => `${esc(SERIES[k][0])}: ${statOf(k)}`).join("<br>")}</div></div>`).join("")}</div></div>`;
  drawCharts();
  tickRec();
}
function tickRec() {
  clearInterval(recTimer);
  if (!S.recording.on) return;
  const upd = () => { const el = $("#recTime"); if (!el) return; const t = Math.floor((Date.now() - S.recording.since) / 1000); el.textContent = `● ${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  upd(); recTimer = setInterval(upd, 1000);
}

const SHOW = [["fps", "FPS"], ["frameTime", "Frametime e 1% low"], ["cpu", "CPU (uso e temperatura)"], ["gpu", "GPU (uso e temperatura)"], ["ram", "RAM"], ["vram", "VRAM"],
  ["power", "Consumo (CPU e GPU)"], ["clocks", "Clocks"], ["clock", "Relógio"]];
function overlayPreview(o) {
  const s = S.snap, h = (s && s.hw) || {}, f = (s && s.fps) || {}, sh = o.show, out = [];
  const n = (v, d = 0) => (isNum(v) ? fmt(v, d) : "--");
  const row = (k, cls, v) => `<div class="r"><span class="k ${cls}">${k}</span><span>${v}</span></div>`;
  if (sh.fps) out.push(`<div class="r"><span class="k c">FPS</span><span class="fps">${isNum(f.fps) ? n(f.fps) : "144"}</span></div>`);
  if (sh.frameTime) out.push(row("FT", "p", `${isNum(f.frameTime) ? n(f.frameTime, 1) : "6,9"} ms <span class="dim">1% ${isNum(f.low1) ? n(f.low1) : "118"}</span>`));
  if (sh.cpu) out.push(row("CPU", "", `${n(h.cpuLoad)}% <span class="dim">${isNum(h.cpuTemp) ? n(h.cpuTemp) + "°C" : ""}</span>`));
  if (sh.gpu) out.push(row("GPU", "c", `${n(h.gpuLoad)}% <span class="dim">${isNum(h.gpuTemp) ? n(h.gpuTemp) + "°C" : ""}</span>`));
  if (sh.vram) out.push(row("VRAM", "p", `${isNum(h.vramUsedMb) ? n(h.vramUsedMb / 1024, 1) : "--"} GB`));
  if (sh.ram) out.push(row("RAM", "g", `${n(h.ramUsedGb, 1)} GB`));
  if (sh.power) out.push(row("W", "o", `${n(h.cpuPower)} <span class="dim">CPU</span> ${n(h.gpuPower)} <span class="dim">GPU</span>`));
  if (sh.clocks) out.push(row("MHz", "c", `${n(h.cpuClock)} <span class="dim">/</span> ${n(h.gpuClock)}`));
  if (sh.clock) out.push(row("⏱", "", new Date().toLocaleTimeString(PT, { hour: "2-digit", minute: "2-digit" })));
  const [v, hz] = o.position.split("-");
  const pos = `${v}:12px;${hz}:12px;--origin:${v} ${hz};transform:scale(${o.scale * 0.85});opacity:${o.opacity}`;
  return `<div class="ov-box" style="${pos}">${out.join("") || `<span class="dim">InfoHardware</span>`}</div>`;
}
function renderOverlay() {
  const o = S.settings.overlay;
  $("#content").innerHTML = `<div>${head("Overlay de jogo", `FPS, frametime, CPU, GPU, VRAM e RAM por cima do jogo. Liga e desliga também com <kbd>${esc(S.settings.hotkeys.overlay)}</kbd>.`,
      `<label class="row" style="gap:10px;font-weight:600">${o.enabled ? "Ligado" : "Desligado"}<label class="switch"><input type="checkbox" id="oOn" ${o.enabled ? "checked" : ""}><span></span></label></label>`)}
    <div class="ov-layout">
      <div class="p-settings">
        <div class="set"><div><h4>Posição</h4><p>Canto do monitor principal.</p></div><div class="corner-pick" id="oPos">${["top-left", "top-right", "bottom-left", "bottom-right"].map((k) => `<button data-v="${k}" class="${o.position === k ? "on" : ""}" title="${k}"></button>`).join("")}</div></div>
        <div class="set"><div><h4>Opacidade</h4><p>Quanto do jogo aparece por trás.</p></div><div class="slider-row"><input type="range" id="oOp" min="20" max="100" value="${Math.round(o.opacity * 100)}"><b>${Math.round(o.opacity * 100)}%</b></div></div>
        <div class="set"><div><h4>Tamanho</h4><p>Escala do texto e dos números.</p></div><div class="slider-row"><input type="range" id="oSc" min="60" max="200" step="10" value="${Math.round(o.scale * 100)}"><b>${Math.round(o.scale * 100)}%</b></div></div>
        <div class="set" style="display:block"><h4 style="margin-bottom:12px">O que mostrar</h4><div class="checks">${SHOW.map(([k, n]) =>
          `<label><input type="checkbox" data-show="${k}" ${o.show[k] ? "checked" : ""}>${n}</label>`).join("")}</div></div>
        <p class="faint" style="font-size:12.5px;margin:4px 2px">Aparece em jogos no modo <b>janela sem bordas</b>; em tela cheia exclusiva o Windows pode escondê-lo.${S.engine.status === "running" && !S.engine.fps ? " O FPS precisa do modo completo (administrador)." : ""}</p>
      </div>
      <div class="ov-preview"><div class="scene"></div>${overlayPreview(o)}<div class="tag">Prévia</div></div>
    </div></div>`;
  const set = (patch, rerender = true) => call("settings", { overlay: patch }).then((s) => { S.settings = s; if (rerender) renderOverlay(); }).catch((e) => toast(e.message, "err"));
  const live = () => { const pv = $(".ov-preview"); if (pv) pv.innerHTML = `<div class="scene"></div>${overlayPreview(S.settings.overlay)}<div class="tag">Prévia</div>`; };
  $("#oOn").onchange = (e) => set({ enabled: e.target.checked });
  $("#oPos").onclick = (e) => { const b = e.target.closest("button"); if (b) set({ position: b.dataset.v }); };
  $("#oOp").oninput = (e) => { S.settings.overlay.opacity = e.target.value / 100; e.target.nextElementSibling.textContent = e.target.value + "%"; live(); };
  $("#oOp").onchange = (e) => set({ opacity: e.target.value / 100 }, false);
  $("#oSc").oninput = (e) => { S.settings.overlay.scale = e.target.value / 100; e.target.nextElementSibling.textContent = e.target.value + "%"; live(); };
  $("#oSc").onchange = (e) => set({ scale: e.target.value / 100 }, false);
  $$("[data-show]").forEach((c) => (c.onchange = () => { S.settings.overlay.show[c.dataset.show] = c.checked; live(); set({ show: { [c.dataset.show]: c.checked } }, false); }));
}

function renderSettings() {
  const st = S.settings, e = S.engine;
  const row = (icon, title, text, ctrl) => `<div class="set"><div class="row" style="gap:14px;align-items:flex-start"><i class="i i-${icon}" style="font-size:20px;color:var(--p-text-2);margin-top:2px"></i><div><h4>${title}</h4><p>${text}</p></div></div><div class="row">${ctrl}</div></div>`;
  $("#content").innerHTML = `<div>${head("Ajustes", `InfoHardware ${esc(S.version || "")} · módulo do Piphin Hub`)}
    <div class="p-settings">
      ${row("timer", "Intervalo de atualização", "De quanto em quanto tempo os sensores são lidos.",
        `<select id="sInt">${[250, 500, 1000, 2000, 3000, 5000].map((ms) => `<option value="${ms}" ${st.interval === ms ? "selected" : ""}>${ms < 1000 ? ms + " ms" : ms / 1000 + " s"}</option>`).join("")}</select>`)}
      ${row("shield-check", "Abrir o motor como administrador", "Necessário para temperatura da CPU, discos e FPS. O Windows pede permissão ao abrir o InfoHardware.",
        `<label class="switch"><input type="checkbox" id="sAdm" ${st.admin ? "checked" : ""}><span></span></label>`)}
      ${row("activity", "Motor de sensores", e.status === "running" ? (e.admin ? "Rodando com todos os sensores." : "Rodando em modo limitado.") : e.status === "starting" ? "Iniciando..." : e.status === "error" ? esc(e.error) : "Desligado. Liga sozinho quando você abre o InfoHardware, o overlay ou uma gravação.",
        `${e.status === "running" && !e.admin ? `<button class="btn primary" data-act="elevate"><i class="i i-shield-check"></i>Modo completo</button>` : ""}<button class="btn" data-act="restart"><i class="i i-rotate-ccw"></i>Reiniciar</button>`)}
      ${row("microchip", "Driver PawnIO", e.pawnIo ? "Instalado." : "Não instalado: sem temperatura e consumo da CPU, ventoinhas e tensões da placa-mãe.",
        e.pawnIo ? `<span class="badge ok"><i class="i i-check"></i>instalado</span>` : `<button class="btn" data-act="pawnio"><i class="i i-download"></i>Instalar</button>`)}
      ${row("keyboard", "Atalhos", "Funcionam de qualquer lugar, inclusive dentro do jogo.", `<span class="row faint" style="font-size:12.5px">Overlay <kbd>${esc(st.hotkeys.overlay)}</kbd> · Gravar <kbd>${esc(st.hotkeys.record)}</kbd></span>`)}
    </div></div>`;
  $("#sInt").onchange = (ev) => call("settings", { interval: Number(ev.target.value) }).then((s) => { S.settings = s; toast("Intervalo salvo", "ok"); });
  $("#sAdm").onchange = (ev) => call("settings", { admin: ev.target.checked }).then((s) => { S.settings = s; });
}

// ------------------------------------------------------------------ ações
const ACTIONS = {
  elevate: () => call("elevate").catch((e) => toast(e.message, "err")),
  restart: () => call("restart-engine").catch((e) => toast(e.message, "err")),
  pawnio: () => call("install-pawnio"),
  resetmm: () => call("reset-minmax").then(() => toast("Mínimos e máximos zerados", "ok")),
  report: () => call("export-report").then((f) => f && toast("Relatório salvo", "ok")).catch((e) => toast(e.message, "err")),
  recstart: () => call("record-start").catch((e) => toast(e.message, "err")),
  recstop: () => call("record-stop").then((r) => { if (r) { lastSession = r; toast(`Sessão salva (${r.seconds} s)`, "ok"); } }),
  sessions: () => call("open-sessions"),
  showfile: () => lastSession && call("show-file", lastSession.file),
};

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3500);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]");
  if (t) { tab = t.dataset.tab; render(true); return; }
  const ty = e.target.closest("[data-type]");
  if (ty) { sensorType = ty.dataset.type; renderSensors(); return; }
  const a = e.target.closest("[data-act]");
  if (a && ACTIONS[a.dataset.act]) ACTIONS[a.dataset.act]();
});
window.addEventListener("resize", () => drawCharts());

// ------------------------------------------------------------------ eventos do motor
piphin.on("snap", (s) => {
  S.snap = s;
  pushHistory(s);
  if (tab === "dash") renderDash();
  else if (tab === "sensors") { if ($("table.table tr[data-id]")) updateSensorValues(); else renderSensors(); }
  else if (tab === "perf") { drawCharts(); $$(".perf-grid .stat").forEach((el) => { const keys = el.parentElement.querySelector("canvas").dataset.keys.split(","); el.innerHTML = keys.map((k) => `${esc(SERIES[k][0])}: ${statOf(k)}`).join("<br>"); }); }
  else if (tab === "overlay") { const pv = $(".ov-preview"); if (pv) pv.innerHTML = `<div class="scene"></div>${overlayPreview(S.settings.overlay)}<div class="tag">Prévia</div>`; }
  renderEngine();
});
piphin.on("structure", (g) => { S.structure = g; if (tab === "sensors") renderSensors(); });
piphin.on("info", (i) => { S.info = i; if (tab === "hw") renderHardware(); });
piphin.on("engine", (e) => { S.engine = e; renderEngine(); if (tab === "settings" || !S.snap) render(); });
piphin.on("settings", (s) => { S.settings = s; if (tab === "overlay") renderOverlay(); });
piphin.on("recording", (r) => { S.recording = r; if (r.last) lastSession = r.last; renderEngine(); if (tab === "perf") renderPerf(); });

call("state").then((st) => {
  S = { ...S, ...st };
  if (st.snap) pushHistory(st.snap);
  render(true);
  call("start").catch(() => {});
}).catch((e) => { $("#content").innerHTML = `<div class="p-empty"><i class="i i-circle-x"></i><h3>${esc(e.message)}</h3></div>`; });
