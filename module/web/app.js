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
const TABS = { dash: renderDash, bench: () => renderBench(), hw: renderHardware, sensors: renderSensors, perf: renderPerf, overlay: renderOverlay, settings: renderSettings };

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
  // avisos empilhados: tudo o que falta para ler todos os sensores aparece de uma vez
  const list = [];
  if (e.status === "error") list.push(`<div class="p-banner err"><i class="i i-circle-x"></i><span class="grow">${esc(e.error)}</span><button class="btn sm" data-act="restart"><i class="i i-rotate-ccw"></i>Tentar de novo</button></div>`);
  if (e.status === "running" && !e.admin)
    list.push(`<div class="p-banner"><i class="i i-shield"></i><span class="grow"><b>Modo limitado</b> · sem temperatura da CPU, discos e FPS (${esc(e.limitedReason || "sem administrador")}).</span>
      <button class="btn sm primary" data-act="elevate"><i class="i i-shield-check"></i>Ativar modo completo</button></div>`);
  if (S.pawn && S.pawn.busy)
    list.push(`<div class="p-banner info"><span class="spin"></span><span class="grow"><b>PawnIO</b> · ${esc(S.pawn.text)}...</span></div>`);
  else if (e.status === "running" && e.pawnIoState === "broken")
    list.push(`<div class="p-banner err"><i class="i i-triangle-alert"></i><span class="grow">O driver <b>PawnIO</b> está instalado, mas não carregou no Windows: sem temperatura e consumo da CPU.</span>
      <button class="btn sm primary" data-act="pawnio"><i class="i i-rotate-ccw"></i>Reparar PawnIO</button></div>`);
  else if (e.status === "running" && e.pawnIoState !== "ok" && S.snap && !isNum(S.snap.hw.cpuTemp))
    list.push(`<div class="p-banner info"><i class="i i-info"></i><span class="grow">Temperatura e consumo da CPU precisam do driver <b>PawnIO</b>.</span><button class="btn sm" data-act="pawnio"><i class="i i-download"></i>Instalar PawnIO</button></div>`);
  const b = list.join("");
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

// Aba Hardware: os rótulos vêm do serviço em C# (SystemInfoService.cs). Só os textos fixos dele passam pela tradução;
// nomes de peças, drivers, redes e outros dados do Windows ficam como vêm (o tradutor não mexe em palavras soltas deles).
const HW_TEXT = new Set(["Sistema", "Windows", "Edição", "Versão", "Build", "Arquitetura", "Instalado em", "Último boot", "Tempo ligado", "Computador",
  "Nome", "Usuário", "Fabricante", "Modelo", "Tipo", "Desktop", "Notebook", "Workstation", "Servidor", "Domínio / Grupo", ".NET Runtime",
  "Processador", "Núcleos", "Threads", "Clock base", "Soquete", "Família / Modelo", "Cache L1", "Cache L2", "Cache L3", "Virtualização", "Ativada",
  "Desativada", "ID do processador", "Instruções", "Suportadas", "Placa-mãe", "Placa", "Revisão", "Número de série", "BIOS / UEFI", "Data",
  "Modo de firmware", "Legacy (BIOS)", "Secure Boot", "Ativado", "Desativado", "Segurança", "TPM", "Memória", "Resumo", "Total instalado",
  "Velocidade configurada", "Módulos", "Slots", "Capacidade máxima", "Single channel", "Dual channel (provável)", "Canais", "Capacidade",
  "Part number", "Velocidade nominal", "Velocidade atual", "Formato", "Tensão", "Placa de vídeo", "Memória de vídeo", "Processador de vídeo",
  "Driver", "Data do driver", "Resolução atual", "Taxa de atualização", "Status", "Monitores", "Tamanho", "Ano de fabricação", "Resolução",
  "Profundidade de cor", "Principal", "Sim", "Não", "1 monitor", "Armazenamento", "Saudável", "Atenção", "Não saudável", "Saúde", "Rotação",
  "Firmware", "Volumes", "Rede", "Adaptador", "Ethernet (cabo)", "Wi-Fi", "Conectado", "Desconectado", "Velocidade do link", "Endereço MAC",
  "Gateway", "Áudio", "Dispositivos", "Bateria", "Carga", "Descarregando", "Na tomada", "Carregada", "Carregando", "Química", "Chumbo-ácido"]);
// textos montados no C# com número: viram frases inteiras aqui
function hwPhrase(t) {
  let m;
  if ((m = /^(\d+) conexão\(ões\) ativa\(s\)$/.exec(t))) return m[1] === "1" ? "1 conexão ativa" : `${m[1]} conexões ativas`;
  if ((m = /^(\d+) dispositivo\(s\)$/.exec(t))) return m[1] === "1" ? "1 dispositivo" : `${m[1]} dispositivos`;
  if ((m = /^(\d+) disco\(s\) · (.+)$/.exec(t))) return m[1] === "1" ? `1 disco · ${m[2]}` : `${m[1]} discos · ${m[2]}`;
  if ((m = /^(\d+) monitores$/.exec(t))) return `${m[1]} monitores`;
  if ((m = /^Monitor (\d+)$/.exec(t))) return `Monitor ${m[1]}`;
  if ((m = /^Versão (.+)$/.exec(t))) return `Versão ${m[1]}`;
  return null;
}
// datas do C# (dd/MM/yyyy [HH:mm]) no formato do idioma escolhido
function hwDate(t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(t);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  return m[4] ? d.toLocaleString(PT, { dateStyle: "short", timeStyle: "short" }) : d.toLocaleDateString(PT);
}
// texto da aba Hardware: fixo (traduz) ou dado do Windows (não traduz)
function hwHtml(t) {
  t = String(t ?? "");
  if (HW_TEXT.has(t)) return esc(t);
  const p = hwPhrase(t);
  if (p) return esc(p);
  const d = hwDate(t);
  return `<span data-noi18n>${esc(d || t)}</span>`;
}

function renderHardware() {
  if (!S.info) { $("#content").innerHTML = `<div class="p-empty"><span class="spin" style="width:28px;height:28px"></span><h3>Lendo as informações do hardware...</h3></div>`; call("info").then((i) => { if (i) { S.info = i; render(); } }).catch(() => {}); return; }
  const sm = S.info.summary;
  $("#content").innerHTML = `<div>${head(esc(sm.computer || "Hardware"), esc([sm.cpu, sm.gpu, sm.ram].filter(Boolean).join(" · ")),
    `<button class="btn" data-act="report"><i class="i i-file-text"></i>Exportar relatório</button>`)}` +
    S.info.sections.map((sec) => `<div class="card hw-sec"><div class="head"><span class="glyph">${esc(sec.glyph || "")}</span><div><h3>${hwHtml(sec.title)}</h3>
      ${sec.subtitle ? `<div class="sub">${hwHtml(sec.subtitle)}</div>` : ""}</div></div>
      ${sec.groups.map((g) => `<div class="hw-group">${g.header ? `<h4>${hwHtml(g.header)}</h4>` : ""}<dl class="kv">${g.items.map((it) => `<dt>${hwHtml(it.label)}</dt><dd>${hwHtml(it.value)}</dd>`).join("")}</dl></div>`).join("")}</div>`).join("") + `</div>`;
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
    rows.push(`<tr class="grp"><td colspan="5"><i class="i i-${HW_ICONS[g.type] || "microchip"}"></i><span data-noi18n>${esc(g.name)}</span></td></tr>`);
    for (const s of list) {
      shown++;
      const t = SENSOR_TYPES[s.type] || [s.type, C.gray];
      const v = S.snap.sensors[s.id] || [];
      rows.push(`<tr data-id="${esc(s.id)}"><td data-noi18n>${esc(s.name)}</td><td><span class="tpill" style="--c:${t[1]}">${esc(t[0])}</span></td>
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

const SHOW = [["game", "Jogo e tempo de partida"], ["fps", "FPS"], ["frameTime", "Frametime e 1% low"], ["cpu", "CPU (uso e temperatura)"], ["gpu", "GPU (uso e temperatura)"], ["ram", "RAM"], ["vram", "VRAM"],
  ["power", "Consumo (CPU e GPU)"], ["clocks", "Clocks"], ["clock", "Relógio"]];
const OV_STYLES = [["panel", "Painel", "Tudo, com gráfico"], ["compact", "Linha", "Discreto, numa linha"], ["fps", "Só FPS", "O mínimo possível"]];
const OV_THEMES = [["neon", "Neon"], ["dark", "Escuro"], ["glass", "Transparente"]];
// leitura de exemplo para a prévia quando o motor ainda não mandou nada
const SAMPLE = { hw: { cpuLoad: 38, cpuTemp: 67, gpuLoad: 97, gpuTemp: 72, vramUsedMb: 6400, vramTotalMb: 12288, ramUsedGb: 13.4, cpuPower: 74, gpuPower: 231, cpuClock: 5200, gpuClock: 2610 },
  fps: { fps: 144, frameTime: 6.9, low1: 118, process: "jogo.exe" } };
const sampleHist = Array.from({ length: 60 }, (_, i) => 138 + Math.sin(i / 4) * 9 + (i % 7 === 0 ? -22 : 0));
const prevHist = [];
function overlayPreview(o) {
  const live = S.snap && S.snap.fps && isNum(S.snap.fps.fps);
  const snap = live ? S.snap : { ...SAMPLE, hw: { ...SAMPLE.hw, ...((S.snap && S.snap.hw) || {}) } };
  const game = (S.playing && S.playing[0]) || { name: "Seu jogo", since: new Date(Date.now() - 47 * 60000).toISOString() };
  const [v, hz] = o.position.split("-");
  return `<div class="ov-pos" style="${v}:12px;${hz}:12px;transform-origin:${v} ${hz};transform:scale(${o.scale * 0.85});opacity:${o.opacity}">${OverlayRender.html(snap, o, game, live && prevHist.length > 3 ? prevHist : sampleHist)}</div>`;
}
function fitPreview() {
  const pv = $(".ov-preview"), b = pv && pv.querySelector(".ov-pos"); if (!b) return;
  const o = S.settings.overlay, room = pv.clientWidth - 24, w = b.offsetWidth * o.scale * 0.85;
  if (w > room) b.style.transform = `scale(${(room / b.offsetWidth).toFixed(3)})`;
}
function jogosCard(o) {
  const j = S.jogos, playing = S.playing || [];
  const status = j === "ok" ? (playing.length ? `<span class="badge ok"><i class="i i-gamepad-2"></i>Jogando: ${esc(playing[0].name)}</span>` : `<span class="badge"><i class="i i-circle-check"></i>Piphin Jogos conectado</span>`)
    : j === "missing" ? `<span class="badge warn"><i class="i i-info"></i>Instale o Piphin Jogos na Loja do Hub</span>`
    : j === "nohub" ? `<span class="badge warn"><i class="i i-info"></i>Precisa do Piphin Hub 1.5.0</span>` : `<span class="badge"><span class="spin" style="width:12px;height:12px"></span>Procurando o Piphin Jogos</span>`;
  return `<div class="auto-card ${o.auto ? "on" : ""}">
    <div class="auto-ic"><i class="i i-zap"></i></div>
    <div class="auto-txt"><h4>Ligar sozinho quando um jogo abrir</h4>
      <p>O Piphin Jogos avisa quando você abre um jogo de qualquer loja: o overlay aparece, some quando o jogo fecha e o desempenho da partida fica guardado (e aparece na página do jogo no Piphin Jogos). O motor de sensores fica ligado em segundo plano; o Windows pede permissão de administrador uma vez quando o Hub abre.</p>
      <div class="row" style="gap:8px;margin-top:8px">${status}</div></div>
    <label class="switch"><input type="checkbox" id="oAuto" ${o.auto ? "checked" : ""} ${j === "ok" || o.auto ? "" : "disabled"}><span></span></label></div>`;
}
function perfList() {
  const g = (S.perfGames || []).slice().sort((x, y) => String(y.last).localeCompare(String(x.last)));
  if (!g.length) return `<p class="faint" style="font-size:12.5px">Nenhuma partida medida ainda. Com o overlay ligado (ou automático), cada partida de um jogo do Piphin Jogos fica registrada aqui.</p>`;
  return `<div class="perf-mini">${g.map((x) => `<div><b>${esc(x.name)}</b><span>${isNum(x.fps_avg) ? fmt(x.fps_avg) + " FPS em média" : "--"}</span><span class="faint">${x.sessions} ${x.sessions === 1 ? "partida" : "partidas"} · ${x.last ? new Date(x.last).toLocaleDateString(PT) : ""}</span></div>`).join("")}</div>`;
}
function renderOverlay() {
  const o = S.settings.overlay;
  const opt = (name, list, cur) => `<div class="opt-grid" data-opt="${name}">${list.map(([k, l, d]) => `<button class="opt ${cur === k ? "on" : ""}" data-v="${k}"><b>${l}</b>${d ? `<span>${d}</span>` : ""}</button>`).join("")}</div>`;
  $("#content").innerHTML = `<div>${head("Overlay de jogo", `FPS, temperaturas e uso por cima do jogo. Liga e desliga também com <kbd>${esc(S.settings.hotkeys.overlay)}</kbd>.`,
      `<label class="row" style="gap:10px;font-weight:600">${o.enabled ? "Sempre ligado" : "Desligado"}<label class="switch"><input type="checkbox" id="oOn" ${o.enabled ? "checked" : ""}><span></span></label></label>`)}
    ${jogosCard(o)}
    <div class="ov-layout">
      <div class="p-settings">
        <div class="set" style="display:block"><h4 style="margin-bottom:10px">Estilo</h4>${opt("style", OV_STYLES, o.style)}</div>
        <div class="set" style="display:block"><h4 style="margin-bottom:10px">Tema</h4>${opt("theme", OV_THEMES, o.theme)}</div>
        <div class="set"><div><h4>Posição</h4><p>Canto do monitor principal.</p></div><div class="corner-pick" id="oPos">${["top-left", "top-right", "bottom-left", "bottom-right"].map((k) => `<button data-v="${k}" class="${o.position === k ? "on" : ""}" title="${k}"></button>`).join("")}</div></div>
        <div class="set"><div><h4>Opacidade</h4><p>Quanto do jogo aparece por trás.</p></div><div class="slider-row"><input type="range" id="oOp" min="20" max="100" value="${Math.round(o.opacity * 100)}"><b>${Math.round(o.opacity * 100)}%</b></div></div>
        <div class="set"><div><h4>Tamanho</h4><p>Escala do texto e dos números.</p></div><div class="slider-row"><input type="range" id="oSc" min="60" max="200" step="10" value="${Math.round(o.scale * 100)}"><b>${Math.round(o.scale * 100)}%</b></div></div>
        <div class="set"><div><h4>Gráfico de FPS</h4><p>Últimos 60 segundos, ao lado do FPS (estilo Painel).</p></div><label class="switch"><input type="checkbox" id="oGraph" ${o.graph !== false ? "checked" : ""}><span></span></label></div>
        <div class="set"><div><h4>Cores de alerta</h4><p>FPS baixo em amarelo/vermelho; temperatura alta muda de cor e pisca.</p></div><label class="switch"><input type="checkbox" id="oColors" ${o.colors !== false ? "checked" : ""}><span></span></label></div>
        <div class="set" style="display:block"><h4 style="margin-bottom:12px">O que mostrar</h4><div class="checks">${SHOW.map(([k, n]) =>
          `<label><input type="checkbox" data-show="${k}" ${o.show[k] ? "checked" : ""}>${n}</label>`).join("")}</div></div>
        <div class="set" style="display:block"><h4 style="margin-bottom:10px">Desempenho por jogo</h4>${perfList()}</div>
        <p class="faint" style="font-size:12.5px;margin:4px 2px">Aparece em jogos no modo <b>janela sem bordas</b>; em tela cheia exclusiva o Windows pode escondê-lo.${S.engine.status === "running" && !S.engine.fps ? " O FPS precisa do modo completo (administrador)." : ""}</p>
      </div>
      <div class="ov-preview"><div class="scene"></div>${overlayPreview(o)}<div class="tag">Prévia</div></div>
    </div></div>`;
  fitPreview();
  const set = (patch, rerender = true) => call("settings", { overlay: patch }).then((s) => { S.settings = s; if (rerender) renderOverlay(); }).catch((e) => toast(e.message, "err"));
  const live = () => { const pv = $(".ov-preview"); if (pv) pv.innerHTML = `<div class="scene"></div>${overlayPreview(S.settings.overlay)}<div class="tag">Prévia</div>`; fitPreview(); };
  $("#oOn").onchange = (e) => set({ enabled: e.target.checked });
  $("#oAuto").onchange = (e) => set({ auto: e.target.checked });
  $("#oGraph").onchange = (e) => { S.settings.overlay.graph = e.target.checked; live(); set({ graph: e.target.checked }, false); };
  $("#oColors").onchange = (e) => { S.settings.overlay.colors = e.target.checked; live(); set({ colors: e.target.checked }, false); };
  $$("[data-opt]").forEach((g) => (g.onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) set({ [g.dataset.opt]: b.dataset.v }); }));
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
      ${row("microchip", "Driver PawnIO", e.pawnIoState === "ok" ? "Instalado e carregado." : e.pawnIoState === "broken"
        ? "Instalado, mas o driver não carregou no Windows: sem temperatura e consumo da CPU. Reparar reinstala o driver."
        : "Não instalado: sem temperatura e consumo da CPU, ventoinhas e tensões da placa-mãe.",
        e.pawnIoState === "ok" ? `<span class="badge ok"><i class="i i-check"></i>funcionando</span>`
        : e.pawnIoState === "broken" ? `<button class="btn primary" data-act="pawnio"><i class="i i-rotate-ccw"></i>Reparar</button>`
        : `<button class="btn" data-act="pawnio"><i class="i i-download"></i>Instalar</button>`)}
      ${row("keyboard", "Atalhos", "Funcionam de qualquer lugar, inclusive dentro do jogo.", `<span class="row faint" style="font-size:12.5px">Overlay <kbd>${esc(st.hotkeys.overlay)}</kbd> · Gravar <kbd>${esc(st.hotkeys.record)}</kbd></span>`)}
    </div></div>`;
  $("#sInt").onchange = (ev) => call("settings", { interval: Number(ev.target.value) }).then((s) => { S.settings = s; toast("Intervalo salvo", "ok"); });
  $("#sAdm").onchange = (ev) => call("settings", { admin: ev.target.checked }).then((s) => { S.settings = s; });
}

// ------------------------------------------------------------------ ações
const ACTIONS = {
  benchstart: () => call("bench-start").then((b) => { B = { ...B, ...b }; renderBench(); }).catch((e) => toast(e.message, "err")),
  benchcancel: () => call("bench-cancel"),
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
  const ba = e.target.closest("[data-benchact]");
  if (ba) {
    if (ba.dataset.benchact === "pawnio") return ACTIONS.pawnio();
    return call("bench-action", ba.dataset.benchact).then((m) => m && toast(m, "ok")).catch((er) => toast(er.message, "err"));
  }
  const a = e.target.closest("[data-act]");
  if (a && ACTIONS[a.dataset.act]) ACTIONS[a.dataset.act]();
});
window.addEventListener("resize", () => drawCharts());

// ------------------------------------------------------------------ eventos do motor
piphin.on("snap", (s) => {
  S.snap = s;
  pushHistory(s);
  if (tab === "dash") renderDash();
  else if (tab === "bench" && B.running) renderBenchRunning();
  else if (tab === "sensors") { if ($("table.table tr[data-id]")) updateSensorValues(); else renderSensors(); }
  else if (tab === "perf") { drawCharts(); $$(".perf-grid .stat").forEach((el) => { const keys = el.parentElement.querySelector("canvas").dataset.keys.split(","); el.innerHTML = keys.map((k) => `${esc(SERIES[k][0])}: ${statOf(k)}`).join("<br>"); }); }
  else if (tab === "overlay") { const pv = $(".ov-preview"); if (pv) pv.innerHTML = `<div class="scene"></div>${overlayPreview(S.settings.overlay)}<div class="tag">Prévia</div>`; fitPreview(); }
  if (s.fps && isNum(s.fps.fps)) { prevHist.push(s.fps.fps); if (prevHist.length > 60) prevHist.shift(); }
  renderEngine();
});
piphin.on("pawnio", (p) => { S.pawn = p; renderEngine(); });
call("pawnio-state").then((p) => { S.pawn = p; renderEngine(); }).catch(() => {});
piphin.on("structure", (g) => { S.structure = g; if (tab === "sensors") renderSensors(); });
piphin.on("info", (i) => { S.info = i; if (tab === "hw") renderHardware(); });
piphin.on("engine", (e) => { S.engine = e; renderEngine(); if (tab === "settings" || !S.snap) render(); });
piphin.on("settings", (s) => { S.settings = s; if (tab === "overlay") renderOverlay(); });
// Piphin Jogos (jogo aberto) e desempenho de cada partida
piphin.on("jogos", (j) => { S.jogos = j; if (tab === "overlay") renderOverlay(); });
piphin.on("playing", (p) => { S.playing = p; if (tab === "overlay") renderOverlay(); });
piphin.on("perf-session", (r) => {
  call("perf-games").then((g) => { S.perfGames = g; if (tab === "overlay") renderOverlay(); }).catch(() => {});
  toast(`${r.name}: ${fmt(r.fps_avg)} FPS em média nesta partida`, "ok");
});
piphin.on("recording", (r) => { S.recording = r; if (r.last) lastSession = r.last; renderEngine(); if (tab === "perf") renderPerf(); });

piphin.on("bench", (b) => {
  const was = B.running;
  B = { ...B, ...b };
  if (b.error) toast(b.error, "err");
  if (tab === "bench") { if (B.running && was && $(".bench-hero.running")) renderBenchRunning(); else render(); }
  else if (was && !B.running && B.last && !b.error) toast(`Teste concluído: ${fmt(B.last.overall)} pontos (${B.last.tier.name})`, "ok");
});
call("bench-state").then((b) => { B = { ...B, ...b }; if (tab === "bench") render(); }).catch(() => {});
call("state").then((st) => {
  S = { ...S, ...st };
  if (st.snap) pushHistory(st.snap);
  render(true);
  call("start").catch(() => {});
}).catch((e) => { $("#content").innerHTML = `<div class="p-empty"><i class="i i-circle-x"></i><h3>${esc(e.message)}</h3></div>`; });
