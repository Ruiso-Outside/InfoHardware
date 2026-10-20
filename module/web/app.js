// InfoHardware dentro do Piphin Hub: telas Painel, Hardware, Sensores, Desempenho, Overlay e Ajustes.
// Os dados vêm do motor de sensores pelo módulo (window.piphin).
const $ = (s, el = document) => el.querySelector(s);
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

const COLORS = { purple: "#a855f7", pink: "#ff3cac", cyan: "#22d3ee", green: "#39ff88", orange: "#ffb020", red: "#ff4d6d", blue: "#5b8cff", yellow: "#f7e26b" };
const SENSOR_TYPES = {
  Voltage: ["Tensão", COLORS.yellow, (v) => fmt(v, 3) + " V"], Current: ["Corrente", COLORS.yellow, (v) => fmt(v, 2) + " A"],
  Power: ["Potência", COLORS.orange, (v) => fmt(v, 1) + " W"], Clock: ["Clock", COLORS.cyan, mhz],
  Temperature: ["Temperatura", COLORS.pink, (v) => fmt(v, 1) + " °C"], Load: ["Uso", COLORS.purple, (v) => fmt(v, 1) + " %"],
  Frequency: ["Frequência", COLORS.cyan, (v) => fmt(v, 1) + " Hz"], Fan: ["Ventoinha", COLORS.green, (v) => fmt(v) + " RPM"],
  Flow: ["Fluxo", COLORS.blue, (v) => fmt(v, 1) + " L/h"], Control: ["Controle", COLORS.green, (v) => fmt(v, 1) + " %"],
  Level: ["Nível", COLORS.purple, (v) => fmt(v, 1) + " %"], Factor: ["Fator", "#a495cc", (v) => fmt(v, 3)],
  Data: ["Dados", COLORS.blue, (v) => fmt(v, 2) + " GB"], SmallData: ["Dados", COLORS.blue, (v) => fmt(v, 1) + " MB"],
  Throughput: ["Taxa", COLORS.cyan, rate], TimeSpan: ["Tempo", "#a495cc", (v) => fmt(v) + " s"], Timing: ["Latência", "#a495cc", (v) => fmt(v, 2) + " ns"],
  Energy: ["Energia", COLORS.orange, (v) => fmt(v) + " mWh"], Noise: ["Ruído", "#a495cc", (v) => fmt(v, 1) + " dBA"],
  Conductivity: ["Condutividade", "#a495cc", (v) => fmt(v, 1) + " µS/cm"], Humidity: ["Umidade", COLORS.blue, (v) => fmt(v) + " %"],
};
const sensorFmt = (type, v) => (isNum(v) ? (SENSOR_TYPES[type] || [type, "", (x) => fmt(x, 2)])[2](v) : "--");

// ------------------------------------------------------------------ estado
let S = { engine: { status: "off" }, structure: [], snap: null, info: null, settings: null, recording: { on: false }, metrics: [] };
let tab = "dash";
let sensorFilter = "";
const HISTORY = 120; // 2 minutos a 1 leitura/s
const hist = {}; // métrica -> [valores]
const SERIES = {
  cpuLoad: ["Uso da CPU", COLORS.purple, "%", (s) => s.hw.cpuLoad], cpuTemp: ["Temperatura da CPU", COLORS.pink, "°C", (s) => s.hw.cpuTemp],
  gpuLoad: ["Uso da GPU", COLORS.cyan, "%", (s) => s.hw.gpuLoad], gpuTemp: ["Temperatura da GPU", COLORS.orange, "°C", (s) => s.hw.gpuTemp],
  fps: ["FPS", COLORS.cyan, "", (s) => s.fps && s.fps.fps], frameTime: ["Frametime", COLORS.pink, "ms", (s) => s.fps && s.fps.frameTime],
  ramLoad: ["Uso da RAM", COLORS.green, "%", (s) => s.hw.ramLoad], vramLoad: ["Uso da VRAM", COLORS.pink, "%", (s) => (s.hw.vramTotalMb ? (s.hw.vramUsedMb / s.hw.vramTotalMb) * 100 : null)],
  cpuPower: ["Consumo da CPU", COLORS.orange, "W", (s) => s.hw.cpuPower], gpuPower: ["Consumo da GPU", COLORS.green, "W", (s) => s.hw.gpuPower],
  netDown: ["Download", COLORS.green, "B/s", (s) => s.hw.netDown], netUp: ["Upload", COLORS.purple, "B/s", (s) => s.hw.netUp],
  diskRead: ["Leitura do disco", COLORS.cyan, "B/s", (s) => s.hw.diskRead], diskWrite: ["Escrita do disco", COLORS.pink, "B/s", (s) => s.hw.diskWrite],
};
function pushHistory(s) {
  for (const [k, def] of Object.entries(SERIES)) {
    const v = def[3](s);
    const arr = hist[k] || (hist[k] = []);
    arr.push(isNum(v) ? v : NaN);
    if (arr.length > HISTORY) arr.shift();
  }
}

// ------------------------------------------------------------------ desenho: medidor e gráfico
function gauge(value, max, color, label, unit, text) {
  const pct = isNum(value) ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = 44, c = Math.PI * r * 1.5; // arco de 270°
  return `<div class="gauge"><svg viewBox="0 0 120 108">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#241f40" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c} 999" transform="rotate(135 60 60)"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * pct} 999" transform="rotate(135 60 60)"
      style="filter: drop-shadow(0 0 5px ${color}88)"/></svg>
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
  g.strokeStyle = "#221d3d"; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = Math.round((h * i) / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (const k of keys) {
    const arr = hist[k] || [];
    const color = SERIES[k][1];
    g.beginPath();
    let started = false;
    arr.forEach((v, i) => {
      if (!isNum(v)) { started = false; return; }
      const x = w - ((arr.length - 1 - i) / (HISTORY - 1)) * w, y = h - (v / max) * (h - 6) - 3;
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    });
    g.strokeStyle = color; g.lineWidth = 2; g.shadowColor = color; g.shadowBlur = 6; g.stroke(); g.shadowBlur = 0;
  }
}
const legend = (keys) => `<div class="legend">${keys.map((k) => `<span><i style="background:${SERIES[k][1]}"></i>${esc(SERIES[k][0])}</span>`).join("")}</div>`;
const statOf = (k) => {
  const a = (hist[k] || []).filter(isNum);
  if (!a.length) return "sem dados";
  const f = SERIES[k][2] === "B/s" ? rate : (v) => fmt(v, SERIES[k][2] === "ms" ? 1 : 0) + (SERIES[k][2] && SERIES[k][2] !== "B/s" ? " " + SERIES[k][2] : "");
  return `mín ${f(Math.min(...a))} · méd ${f(a.reduce((x, y) => x + y, 0) / a.length)} · máx ${f(Math.max(...a))}`;
};

// ------------------------------------------------------------------ telas
const TABS = {
  dash: renderDash, hw: renderHardware, sensors: renderSensors, perf: renderPerf, overlay: renderOverlay, settings: renderSettings,
};

function render() {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderEngine();
  TABS[tab]();
}

function renderEngine() {
  const e = S.engine;
  const map = { running: ["on", e.admin ? "Motor ativo (administrador)" : "Motor ativo (modo limitado)"], starting: ["wait", "Iniciando o motor..."],
    off: ["", "Motor desligado"], error: ["err", "Erro no motor"] };
  const [cls, txt] = map[e.status] || ["", e.status];
  $("#engine").innerHTML = `<i class="dot ${cls}"></i>${esc(txt)}`;
  $("#recDot").hidden = !S.recording.on;
  let b = "";
  if (e.status === "error") b = `<div class="banner err"><span class="grow">${esc(e.error)}</span><button class="btn sm" data-act="restart">Tentar de novo</button></div>`;
  else if (e.status === "running" && !e.admin)
    b = `<div class="banner"><span class="grow"><b>Modo limitado</b> (${esc(e.limitedReason || "sem administrador")}): sem temperatura da CPU, discos e FPS.</span>
      <button class="btn sm primary" data-act="elevate">Ativar modo completo</button></div>`;
  else if (e.status === "running" && !e.pawnIo && S.snap && !isNum(S.snap.hw.cpuTemp))
    b = `<div class="banner"><span class="grow">Temperatura e consumo da CPU precisam do driver <b>PawnIO</b>.</span><button class="btn sm" data-act="pawnio">Instalar PawnIO</button></div>`;
  $("#banner").innerHTML = b;
}

function waiting() {
  const e = S.engine;
  return `<div class="empty">${e.status === "error" ? esc(e.error) : e.status === "starting" ? "Iniciando o motor de sensores...<br><span class='muted'>Se o Windows pedir permissão de administrador, aceite para ler todos os sensores.</span>" : "Aguardando os sensores..."}</div>`;
}

function renderDash() {
  const s = S.snap;
  if (!s) { $("#content").innerHTML = waiting(); return; }
  const h = s.hw, f = s.fps;
  const vramPct = h.vramTotalMb ? (h.vramUsedMb / h.vramTotalMb) * 100 : null;
  const ramTotal = (h.ramUsedGb || 0) + (h.ramAvailableGb || 0);
  $("#content").innerHTML = `
    <div class="hero">
      <div class="card dev"><h3>Processador</h3><div class="name">${esc(h.cpuName || "--")}</div>
        <div class="gauges">${gauge(h.cpuLoad, 100, COLORS.purple, "Uso", "%")}${gauge(h.cpuTemp, 100, COLORS.pink, "Temperatura", "°C")}
          ${gauge(h.cpuClock, 6000, COLORS.cyan, "Clock", "", mhz(h.cpuClock))}${gauge(h.cpuPower, 250, COLORS.orange, "Consumo", "W", fmt(h.cpuPower, 1))}</div></div>
      <div class="card dev"><h3>Placa de vídeo</h3><div class="name">${esc(h.gpuName || "--")}</div>
        <div class="gauges">${gauge(h.gpuLoad, 100, COLORS.cyan, "Uso", "%")}${gauge(h.gpuTemp, 100, COLORS.orange, "Temperatura", "°C")}
          ${gauge(vramPct, 100, COLORS.pink, "VRAM", "%")}${gauge(h.gpuPower, 450, COLORS.green, "Consumo", "W", fmt(h.gpuPower, 1))}</div></div>
    </div>
    <div class="row3">
      <div class="card"><h3>FPS <span class="muted" style="text-transform:none;letter-spacing:0">${esc((f && f.process) || (S.engine.fps ? "nenhum jogo detectado" : "precisa de administrador"))}</span></h3>
        <div class="fps-big">${f && isNum(f.fps) ? fmt(f.fps) : "--"}</div>
        <div class="fps-meta"><span>Frametime <b>${f && isNum(f.frameTime) ? fmt(f.frameTime, 1) + " ms" : "--"}</b></span><span>1% low <b>${f && isNum(f.low1) ? fmt(f.low1) : "--"}</b></span></div></div>
      <div class="card"><h3>Memória</h3><div class="kv2">
        <span>RAM</span><b>${fmt(h.ramUsedGb, 1)} de ${fmt(ramTotal, 1)} GB (${fmt(h.ramLoad)}%)</b>
        <span>VRAM</span><b>${isNum(h.vramUsedMb) ? fmt(h.vramUsedMb / 1024, 1) : "--"} de ${isNum(h.vramTotalMb) ? fmt(h.vramTotalMb / 1024, 1) : "--"} GB</b>
        <span>Clock da GPU</span><b>${mhz(h.gpuClock)}</b><span>Clock da VRAM</span><b>${mhz(h.gpuMemClock)}</b>
        <span>Hotspot da GPU</span><b>${isNum(h.gpuHotspot) ? fmt(h.gpuHotspot, 1) + " °C" : "--"}</b><span>Ventoinha da GPU</span><b>${isNum(h.gpuFan) ? fmt(h.gpuFan) + " RPM" : "--"}</b></div></div>
      <div class="card"><h3>Disco e rede</h3><div class="kv2">
        <span>Leitura</span><b>${rate(h.diskRead)}</b><span>Escrita</span><b>${rate(h.diskWrite)}</b>
        <span>Temperatura do disco</span><b>${isNum(h.diskTemp) ? fmt(h.diskTemp) + " °C" : "--"}</b>
        <span>Download</span><b>${rate(h.netDown)}</b><span>Upload</span><b>${rate(h.netUp)}</b></div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3>Carga por núcleo</h3><div class="cores">${(h.coreLoads || []).map((v, i) =>
      `<div class="core" title="Núcleo ${i + 1}: ${fmt(v)}%"><i style="height:${Math.max(2, Math.min(100, v))}%"></i><span>${fmt(v)}</span></div>`).join("")}</div></div>
    <div class="charts2">
      <div class="card"><h3>Uso <span class="muted">2 min</span></h3><canvas class="chart" data-keys="cpuLoad,gpuLoad"></canvas>${legend(["cpuLoad", "gpuLoad"])}</div>
      <div class="card"><h3>Temperatura <span class="muted">2 min</span></h3><canvas class="chart" data-keys="cpuTemp,gpuTemp"></canvas>${legend(["cpuTemp", "gpuTemp"])}</div>
    </div>`;
  drawCharts();
}

function drawCharts() { document.querySelectorAll("canvas.chart").forEach((c) => drawChart(c, c.dataset.keys.split(","))); }

function renderHardware() {
  if (!S.info) { $("#content").innerHTML = `<div class="empty">Lendo as informações do hardware...</div>`; call("info").then((i) => { if (i) { S.info = i; render(); } }).catch(() => {}); return; }
  $("#content").innerHTML = `<div class="toolbar"><h2 style="flex:1">${esc(S.info.summary.computer || "Hardware")}</h2>
      <button class="btn" data-act="report">Exportar relatório (.txt)</button></div>` +
    S.info.sections.map((sec) => `<div class="card hwsec"><div class="head"><span class="glyph">${esc(sec.glyph || "◆")}</span><h3>${esc(sec.title)}</h3><span class="muted">${esc(sec.subtitle || "")}</span></div>
      ${sec.groups.map((g) => `<div class="hwgroup">${g.header ? `<h4>${esc(g.header)}</h4>` : ""}<dl class="kv">${g.items.map((it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.value)}</dd>`).join("")}</dl></div>`).join("")}</div>`).join("");
}

function renderSensors() {
  if (!S.structure.length || !S.snap) { $("#content").innerHTML = waiting(); return; }
  const q = sensorFilter.trim().toLowerCase();
  const rows = [];
  for (const g of S.structure) {
    const list = g.sensors.filter((s) => !q || (g.name + " " + s.name + " " + (SENSOR_TYPES[s.type] || [s.type])[0]).toLowerCase().includes(q));
    if (!list.length) continue;
    rows.push(`<tr class="grp"><td colspan="5">${esc(g.name)}</td></tr>`);
    for (const s of list) {
      const t = SENSOR_TYPES[s.type] || [s.type, "#a495cc"];
      const v = S.snap.sensors[s.id] || [];
      rows.push(`<tr data-id="${esc(s.id)}"><td>${esc(s.name)}</td><td><span class="tpill" style="color:${t[1]}">${esc(t[0])}</span></td>
        <td class="num v">${sensorFmt(s.type, v[0])}</td><td class="num mn">${sensorFmt(s.type, v[1])}</td><td class="num mx">${sensorFmt(s.type, v[2])}</td></tr>`);
    }
  }
  const focused = document.activeElement && document.activeElement.id === "sFilter";
  $("#content").innerHTML = `<div class="toolbar"><input type="search" id="sFilter" placeholder="Filtrar sensores (ex.: temperatura, GPU, fan)" value="${esc(sensorFilter)}" style="flex:1;max-width:420px">
      <button class="btn" data-act="resetmm">Zerar mín/máx</button><span class="muted">${S.structure.reduce((n, g) => n + g.sensors.length, 0)} sensores</span></div>
    <table class="sens"><thead><tr><th>Sensor</th><th>Tipo</th><th style="text-align:right">Atual</th><th style="text-align:right">Mínimo</th><th style="text-align:right">Máximo</th></tr></thead>
    <tbody>${rows.join("") || `<tr><td colspan="5" class="muted">Nenhum sensor encontrado</td></tr>`}</tbody></table>`;
  const inp = $("#sFilter");
  inp.oninput = (e) => { sensorFilter = e.target.value; renderSensors(); };
  if (focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

// só atualiza os números da tabela (sem redesenhar tudo a cada segundo)
function updateSensorValues() {
  const types = {};
  for (const g of S.structure) for (const s of g.sensors) types[s.id] = s.type;
  document.querySelectorAll("table.sens tr[data-id]").forEach((tr) => {
    const v = S.snap.sensors[tr.dataset.id] || [], t = types[tr.dataset.id];
    $(".v", tr).textContent = sensorFmt(t, v[0]); $(".mn", tr).textContent = sensorFmt(t, v[1]); $(".mx", tr).textContent = sensorFmt(t, v[2]);
  });
}

let recTimer = null, lastSession = null;
function renderPerf() {
  const r = S.recording;
  const charts = [["cpuLoad", "gpuLoad"], ["cpuTemp", "gpuTemp"], ["fps"], ["frameTime"], ["ramLoad", "vramLoad"], ["cpuPower", "gpuPower"], ["netDown", "netUp"], ["diskRead", "diskWrite"]];
  const titles = ["Uso", "Temperatura", "FPS", "Frametime", "Memória", "Consumo", "Rede", "Disco"];
  $("#content").innerHTML = `<div class="recbar">
      ${r.on ? `<button class="btn danger" data-act="recstop">■ Parar gravação</button><span class="rectime" id="recTime"></span>`
        : `<button class="btn primary" data-act="recstart">● Gravar sessão</button>`}
      <span class="muted">Grava todas as métricas em CSV (<kbd>${esc(S.settings.hotkeys.record)}</kbd>)</span><div class="spacer"></div>
      <button class="btn" data-act="sessions">Abrir pasta das sessões</button></div>
    ${lastSession && !r.on ? `<div class="card" style="margin-bottom:14px"><h3>Última sessão <span class="muted" style="text-transform:none;letter-spacing:0">${lastSession.seconds} s · ${lastSession.rows} leituras</span>
      <button class="btn sm" data-act="showfile">Mostrar arquivo</button></h3>
      <table class="summary"><thead><tr><th>Métrica</th><th>Mínimo</th><th>Média</th><th>Máximo</th></tr></thead><tbody>
      ${lastSession.summary.map((m) => `<tr><td>${esc(m.name)}</td><td>${fmt(m.min, 1)}</td><td>${fmt(m.avg, 1)}</td><td>${fmt(m.max, 1)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="perf-grid">${charts.map((keys, i) => `<div class="card"><h3>${titles[i]} <span class="muted">2 min</span></h3>
      <canvas class="chart" data-keys="${keys.join(",")}"></canvas>${legend(keys)}<div class="stat">${keys.map((k) => `${esc(SERIES[k][0])}: ${statOf(k)}`).join("<br>")}</div></div>`).join("")}</div>`;
  drawCharts();
  tickRec();
}
function tickRec() {
  clearInterval(recTimer);
  if (!S.recording.on) return;
  const upd = () => { const el = $("#recTime"); if (!el) return; const t = Math.floor((Date.now() - S.recording.since) / 1000); el.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
  upd(); recTimer = setInterval(upd, 1000);
}

function renderOverlay() {
  const o = S.settings.overlay;
  const show = [["fps", "FPS"], ["frameTime", "Frametime e 1% low"], ["cpu", "CPU (uso e temperatura)"], ["gpu", "GPU (uso e temperatura)"], ["ram", "RAM"], ["vram", "VRAM"],
    ["power", "Consumo (CPU e GPU)"], ["clocks", "Clocks"], ["clock", "Relógio"]];
  const pos = [["top-left", "↖ Superior esquerdo"], ["top-right", "↗ Superior direito"], ["bottom-left", "↙ Inferior esquerdo"], ["bottom-right", "↘ Inferior direito"]];
  $("#content").innerHTML = `<h2>Overlay de jogo</h2><p class="sub">FPS, frametime, CPU, GPU, VRAM e RAM por cima do jogo. Aparece em jogos no modo <b>janela sem bordas</b>; em tela cheia exclusiva o Windows pode escondê-lo.</p>
    <div class="set"><div><h4>Mostrar overlay</h4><p>Liga e desliga também pelo atalho <kbd>${esc(S.settings.hotkeys.overlay)}</kbd>, de qualquer lugar.</p></div>
      <label class="switch"><input type="checkbox" id="oOn" ${o.enabled ? "checked" : ""}><span></span></label></div>
    <div class="set"><div><h4>Posição</h4><p>Canto do monitor principal.</p></div><div class="seg" id="oPos">${pos.map(([k, n]) => `<button data-v="${k}" class="${o.position === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="set"><div><h4>Opacidade</h4><p>${Math.round(o.opacity * 100)}%</p></div><input type="range" id="oOp" min="20" max="100" value="${Math.round(o.opacity * 100)}"></div>
    <div class="set"><div><h4>Tamanho</h4><p>${Math.round(o.scale * 100)}%</p></div><input type="range" id="oSc" min="60" max="200" step="10" value="${Math.round(o.scale * 100)}"></div>
    <div class="set" style="display:block"><h4 style="margin-bottom:10px">O que mostrar</h4><div class="checks">${show.map(([k, n]) =>
      `<label><input type="checkbox" data-show="${k}" ${o.show[k] ? "checked" : ""}>${n}</label>`).join("")}</div></div>
    ${S.engine.status === "running" && !S.engine.fps ? `<p class="muted">O FPS precisa do motor com administrador${S.engine.fpsError ? ` (${esc(S.engine.fpsError)})` : ""}.</p>` : ""}`;
  const set = (patch) => call("settings", { overlay: patch }).then((s) => { S.settings = s; }).catch((e) => toast(e.message, "err"));
  $("#oOn").onchange = (e) => set({ enabled: e.target.checked });
  $("#oPos").onclick = (e) => { const b = e.target.closest("button"); if (b) { set({ position: b.dataset.v }).then(renderOverlay); } };
  $("#oOp").onchange = (e) => set({ opacity: e.target.value / 100 }).then(renderOverlay);
  $("#oSc").onchange = (e) => set({ scale: e.target.value / 100 }).then(renderOverlay);
  document.querySelectorAll("[data-show]").forEach((c) => (c.onchange = () => set({ show: { [c.dataset.show]: c.checked } })));
}

function renderSettings() {
  const st = S.settings, e = S.engine;
  $("#content").innerHTML = `<h2>Ajustes</h2><p class="sub">InfoHardware ${esc(S.version || "")} · módulo do Piphin Hub</p>
    <div class="set"><div><h4>Intervalo de atualização</h4><p>De quanto em quanto tempo os sensores são lidos.</p></div>
      <select id="sInt">${[250, 500, 1000, 2000, 3000, 5000].map((ms) => `<option value="${ms}" ${st.interval === ms ? "selected" : ""}>${ms < 1000 ? ms + " ms" : ms / 1000 + " s"}</option>`).join("")}</select></div>
    <div class="set"><div><h4>Abrir o motor como administrador</h4><p>Necessário para temperatura da CPU, discos e FPS. O Windows pede permissão ao abrir o InfoHardware.</p></div>
      <label class="switch"><input type="checkbox" id="sAdm" ${st.admin ? "checked" : ""}><span></span></label></div>
    <div class="set"><div><h4>Motor de sensores</h4><p>${e.status === "running" ? (e.admin ? "Rodando como administrador" : "Rodando em modo limitado") : e.status === "starting" ? "Iniciando..." : e.status === "error" ? esc(e.error) : "Desligado (liga sozinho quando você abre o InfoHardware, o overlay ou uma gravação)"}</p></div>
      <div style="display:flex;gap:8px">${e.status === "running" && !e.admin ? `<button class="btn primary" data-act="elevate">Modo completo</button>` : ""}<button class="btn" data-act="restart">Reiniciar o motor</button></div></div>
    <div class="set"><div><h4>Driver PawnIO</h4><p>${e.pawnIo ? "Instalado." : "Não instalado: sem temperatura e consumo da CPU, ventoinhas e tensões da placa-mãe."}</p></div>
      ${e.pawnIo ? "" : `<button class="btn" data-act="pawnio">Instalar PawnIO</button>`}</div>
    <div class="set"><div><h4>Atalhos</h4><p>Overlay: <kbd>${esc(st.hotkeys.overlay)}</kbd> · Gravar sessão: <kbd>${esc(st.hotkeys.record)}</kbd></p></div></div>`;
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
  if (t) { tab = t.dataset.tab; render(); return; }
  const a = e.target.closest("[data-act]");
  if (a && ACTIONS[a.dataset.act]) ACTIONS[a.dataset.act]();
});
window.addEventListener("resize", () => drawCharts());

// ------------------------------------------------------------------ eventos do motor
piphin.on("snap", (s) => {
  S.snap = s;
  pushHistory(s);
  if (tab === "dash") renderDash();
  else if (tab === "sensors") { if (document.querySelector("table.sens")) updateSensorValues(); else renderSensors(); }
  else if (tab === "perf") { drawCharts(); document.querySelectorAll(".perf-grid .stat").forEach((el, i) => { const keys = el.parentElement.querySelector("canvas").dataset.keys.split(","); el.innerHTML = keys.map((k) => `${esc(SERIES[k][0])}: ${statOf(k)}`).join("<br>"); }); }
  if (!$("#banner").innerHTML || tab === "dash") renderEngine();
});
piphin.on("structure", (g) => { S.structure = g; if (tab === "sensors") renderSensors(); });
piphin.on("info", (i) => { S.info = i; if (tab === "hw") renderHardware(); });
piphin.on("engine", (e) => { S.engine = e; renderEngine(); if (tab === "settings" || !S.snap) render(); });
piphin.on("settings", (s) => { S.settings = s; if (tab === "overlay") renderOverlay(); });
piphin.on("recording", (r) => { S.recording = r; if (r.last) lastSession = r.last; renderEngine(); if (tab === "perf") renderPerf(); });

call("state").then((st) => {
  S = { ...S, ...st };
  if (st.snap) pushHistory(st.snap);
  render();
  call("start").catch(() => {});
}).catch((e) => { $("#content").innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
