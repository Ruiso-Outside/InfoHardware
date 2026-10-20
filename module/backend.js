// InfoHardware como módulo do Piphin Hub.
// O motor de sensores (engine/, .NET Framework) roda dentro do PowerShell do Windows, por isso não há
// .exe próprio para o Controle Inteligente de Aplicativos barrar. Para ler temperatura da CPU, discos
// e FPS ele precisa de administrador: o motor é aberto com o pedido do Windows (UAC); se a pessoa
// recusar, roda em modo limitado (GPU, uso, RAM, rede continuam funcionando).
// O motor só fica ligado enquanto alguém usa: a tela do módulo aberta, o overlay ou uma gravação.
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const IDLE_STOP_MS = 30000; // desliga o motor 30 s depois de ninguém mais precisar
const SESSIONS_DIR = path.join(os.homedir(), "Documents", "InfoHardware", "Sessoes");

// métricas gravadas nas sessões (mesmas do app)
const METRICS = [
  ["fps", "FPS", (s) => s.fps && s.fps.fps], ["frameTime", "Frametime (ms)", (s) => s.fps && s.fps.frameTime], ["low1", "1% low", (s) => s.fps && s.fps.low1],
  ["cpuLoad", "Uso da CPU (%)", (s) => s.hw.cpuLoad], ["cpuTemp", "Temperatura da CPU (°C)", (s) => s.hw.cpuTemp], ["cpuClock", "Clock da CPU (MHz)", (s) => s.hw.cpuClock],
  ["cpuPower", "Consumo da CPU (W)", (s) => s.hw.cpuPower], ["gpuLoad", "Uso da GPU (%)", (s) => s.hw.gpuLoad], ["gpuTemp", "Temperatura da GPU (°C)", (s) => s.hw.gpuTemp],
  ["gpuHotspot", "Hotspot da GPU (°C)", (s) => s.hw.gpuHotspot], ["gpuClock", "Clock da GPU (MHz)", (s) => s.hw.gpuClock], ["gpuMemClock", "Clock da VRAM (MHz)", (s) => s.hw.gpuMemClock],
  ["gpuPower", "Consumo da GPU (W)", (s) => s.hw.gpuPower], ["gpuFan", "Ventoinha da GPU (RPM)", (s) => s.hw.gpuFan],
  ["vramUsed", "VRAM usada (GB)", (s) => (s.hw.vramUsedMb != null ? s.hw.vramUsedMb / 1024 : null)], ["ramUsed", "RAM usada (GB)", (s) => s.hw.ramUsedGb],
  ["ramLoad", "Uso da RAM (%)", (s) => s.hw.ramLoad], ["diskRead", "Leitura do disco (B/s)", (s) => s.hw.diskRead], ["diskWrite", "Escrita do disco (B/s)", (s) => s.hw.diskWrite],
  ["netDown", "Download (B/s)", (s) => s.hw.netDown], ["netUp", "Upload (B/s)", (s) => s.hw.netUp],
];

const DEFAULTS = {
  interval: 1000,
  admin: true, // abrir o motor como administrador (temperatura da CPU, discos e FPS)
  overlay: { enabled: false, position: "top-left", opacity: 0.85, scale: 1,
    show: { fps: true, frameTime: true, cpu: true, gpu: true, ram: true, vram: true, power: true, clocks: false, clock: false } },
  hotkeys: { overlay: "Ctrl+Shift+O", record: "Ctrl+Shift+R" },
};

exports.activate = (ctx) => {
  const SETTINGS = path.join(ctx.dataDir, "settings.json");
  const ENGINE_DIR = path.join(ctx.dir, "engine");
  let settings = merge(DEFAULTS, readJson(SETTINGS, {}));
  const save = () => { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); };

  // ---------------------------------------------------------------- motor
  let eng = null; // { proc, sock, admin, ... }
  let engine = { status: "off", admin: false, fps: false, pawnIo: false, error: "", limitedReason: "" };
  let structure = [];
  let lastSnap = null;
  let info = null;
  let viewVisible = false;
  let uacDeclined = false; // recusou o UAC nesta sessão: não pergunta de novo sozinho
  let idleTimer = null;
  let starting = null;

  const setEngine = (patch) => { engine = { ...engine, ...patch }; ctx.emit("engine", engine); };
  const needed = () => viewVisible || settings.overlay.enabled || !!rec || bench.running;

  // ---------------------------------------------------------------- teste de desempenho (benchmark)
  const BENCH_FILE = path.join(ctx.dataDir, "bench-history.json");
  const bench = { running: false, phase: "", pct: 0, samples: [], facts: null, last: null, history: readJson(BENCH_FILE, []) };
  const benchPublic = () => ({ running: bench.running, phase: bench.phase, pct: bench.pct, last: bench.last, history: bench.history });

  function powerPlan() {
    try {
      const out = require("child_process").execFileSync("powercfg.exe", ["/getactivescheme"], { windowsHide: true, encoding: "latin1" });
      const guid = (out.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i) || [""])[0].toLowerCase();
      return { guid, saver: guid === "a1841308-3bce-4f6d-9306-ac5b6e05d8b8" };
    } catch { return null; }
  }

  async function startBench() {
    if (bench.running) return benchPublic();
    await ensureEngine();
    Object.assign(bench, { running: true, phase: "start", pct: 0, samples: [], facts: null });
    send({ cmd: "checks" });
    send({ cmd: "bench" });
    ctx.emit("bench", benchPublic());
    return benchPublic();
  }

  function finishBench(result) {
    bench.running = false;
    // temperatura e clock durante o teste (quando os sensores estão disponíveis)
    const temps = bench.samples.map((s) => s.temp).filter((v) => typeof v === "number" && v > 0);
    const multi = bench.samples.filter((s) => s.phase === "multi" && typeof s.clock === "number" && s.clock > 0).map((s) => s.clock);
    const third = Math.max(1, Math.floor(multi.length / 3));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const telemetry = { maxTemp: temps.length ? Math.max(...temps) : null,
      throttle: multi.length >= 4 ? Math.max(0, 1 - avg(multi.slice(-third)) / avg(multi.slice(0, third))) : null };
    const sc = require("./bench").score(result);
    const entry = { at: new Date().toISOString(), ...sc, raw: result, telemetry, cpuName: (lastSnap && lastSnap.hw && lastSnap.hw.cpuName) || "",
      cpus: require("./bench").CPUS,
      tips: require("./bench").tips({ facts: bench.facts || {}, telemetry, powerPlan: powerPlan(), engine }) };
    bench.last = entry;
    bench.history = [{ at: entry.at, overall: sc.overall, single: sc.single, multi: sc.multi, memory: sc.memory, tier: sc.tier.name }, ...bench.history].slice(0, 30);
    try { fs.writeFileSync(BENCH_FILE, JSON.stringify(bench.history, null, 2)); } catch { /* sem disco */ }
    ctx.emit("bench", benchPublic());
    scheduleIdleStop();
  }

  function freePort() {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
      s.on("error", reject);
    });
  }

  // inicia o motor; elevated: pede administrador pelo UAC
  async function startEngine(elevated) {
    if (eng) return;
    if (starting) return starting;
    starting = (async () => {
      setEngine({ status: "starting", error: "" });
      const port = await freePort();
      const token = crypto.randomBytes(16).toString("hex");
      const ps1 = path.join(ENGINE_DIR, "start.ps1");
      const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1, "-Dir", ENGINE_DIR, "-Port", String(port), "-Token", token, "-Parent", String(process.pid)];
      let proc;
      if (elevated) {
        // Start-Process -Verb RunAs: o Windows mostra o pedido de administrador
        const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
        const list = args.map((a) => (/[\s']/.test(a) ? `'"${a.replace(/'/g, "''")}"'` : q(a))).join(",");
        proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @(${list}) -ErrorAction Stop; exit 0 } catch { exit 5 }`], { windowsHide: true, stdio: "ignore" });
        const code = await new Promise((r) => proc.on("exit", r));
        if (code !== 0) { starting = null; throw Object.assign(new Error("O pedido de administrador foi recusado"), { code: "UAC" }); }
        proc = null; // o processo elevado não é nosso filho direto; ele sai sozinho quando este módulo sai
      } else {
        proc = spawn("powershell.exe", args, { windowsHide: true, stdio: "ignore" });
      }
      const sock = await connect(port, token, 45000);
      eng = { proc, sock, buf: "" };
      sock.setEncoding("utf8");
      sock.on("data", (d) => {
        eng.buf += d;
        let i;
        while ((i = eng.buf.indexOf("\n")) >= 0) {
          const line = eng.buf.slice(0, i);
          eng.buf = eng.buf.slice(i + 1);
          try { onMessage(JSON.parse(line)); } catch (e) { ctx.log("mensagem do motor", e); }
        }
      });
      sock.on("close", () => {
        const wasRunning = !!eng;
        eng = null;
        lastSnap = null;
        setEngine({ status: "off" });
        if (bench.running) { bench.running = false; ctx.emit("bench", { ...benchPublic(), error: "O motor de sensores parou durante o teste" }); }
        // caiu sozinho enquanto alguém usava: tenta de novo uma vez
        if (wasRunning && !stopping && needed()) setTimeout(() => ensureEngine().catch(() => {}), 2000);
      });
      send({ cmd: "interval", ms: settings.interval });
      starting = null;
    })();
    try { await starting; } catch (e) { starting = null; throw e; }
  }

  function connect(port, token, timeoutMs) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const s = net.connect(port, "127.0.0.1");
        s.once("connect", () => { s.write(token + "\n"); resolve(s); });
        s.once("error", () => {
          s.destroy();
          if (Date.now() - t0 > timeoutMs) return reject(new Error("O motor de sensores não respondeu (veja %TEMP%\\piphin-infohardware-engine.log)"));
          setTimeout(attempt, 250);
        });
      };
      attempt();
    });
  }

  const send = (obj) => { if (eng && eng.sock.writable) eng.sock.write(JSON.stringify(obj) + "\n"); };

  function onMessage(m) {
    if (m.t === "hello") {
      setEngine({ status: "running", admin: m.admin, fps: m.fps, pawnIo: m.pawnIo, pawnIoState: m.pawnIoState || (m.pawnIo ? "ok" : "missing"), error: "", fpsError: m.fpsError || "",
        limitedReason: m.admin ? "" : engine.limitedReason || "sem administrador" });
      if (!info) send({ cmd: "info" });
    } else if (m.t === "structure") {
      structure = m.groups;
      ctx.emit("structure", structure);
    } else if (m.t === "snap") {
      lastSnap = m;
      ctx.emit("snap", m);
      if (settings.overlay.enabled) ctx.host.sendToWindow("overlay", "snap", m).catch(() => {});
      if (rec) recordRow(m);
      if (bench.running) bench.samples.push({ phase: bench.phase, temp: m.hw.cpuTemp, clock: m.hw.cpuClock });
    } else if (m.t === "bench") {
      bench.phase = m.phase; bench.pct = m.pct;
      ctx.emit("bench", benchPublic());
    } else if (m.t === "checks") {
      bench.facts = m.facts;
    } else if (m.t === "benchDone") {
      finishBench(m.result);
    } else if (m.t === "benchCanceled" || m.t === "benchError") {
      bench.running = false;
      ctx.emit("bench", { ...benchPublic(), error: m.t === "benchError" ? m.message : "" });
      scheduleIdleStop();
    } else if (m.t === "info") {
      info = { sections: m.sections, summary: m.summary, report: m.report };
      ctx.emit("info", info);
    } else if (m.t === "error") {
      ctx.log("motor", m.message);
    }
  }

  // pede para o motor sair e espera ele fechar a conexão (até 3 s); depois força
  let stopping = false;
  function stopEngine() {
    if (!eng) return Promise.resolve();
    stopping = true;
    const e = eng;
    const closed = new Promise((r) => e.sock.once("close", r));
    send({ cmd: "quit" });
    return Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]).then(() => {
      try { e.sock.destroy(); } catch { /* já fechou */ }
      if (e.proc) try { e.proc.kill(); } catch { /* já saiu */ }
      stopping = false;
    });
  }

  // liga o motor quando alguém precisa; com administrador se configurado (e se não foi recusado)
  async function ensureEngine({ forceAdmin = false } = {}) {
    clearTimeout(idleTimer);
    if (eng || starting) return starting;
    const wantAdmin = forceAdmin || (settings.admin && !uacDeclined);
    if (wantAdmin) {
      try { return await startEngine(true); }
      catch (e) {
        if (e.code === "UAC") { uacDeclined = true; setEngine({ limitedReason: "o pedido de administrador foi recusado" }); }
        else { setEngine({ status: "error", error: e.message }); throw e; }
      }
    }
    try { await startEngine(false); }
    catch (e) { setEngine({ status: "error", error: e.message }); throw e; }
  }

  function scheduleIdleStop() {
    clearTimeout(idleTimer);
    if (!needed()) idleTimer = setTimeout(() => { if (!needed()) stopEngine(); }, IDLE_STOP_MS);
  }

  ctx.host.on("view-shown", () => { viewVisible = true; ensureEngine().catch(() => {}); });
  ctx.host.on("view-hidden", () => { viewVisible = false; scheduleIdleStop(); });

  // ---------------------------------------------------------------- gravação de sessão (CSV)
  let rec = null; // { file, stream, since, rows, stats }
  function startRecording() {
    if (rec) return rec.file;
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const file = path.join(SESSIONS_DIR, `sessao-${stamp}.csv`);
    const stream = fs.createWriteStream(file, { flags: "w" });
    stream.write("﻿" + ["Hora", "Processo", ...METRICS.map((m) => m[1])].join(";") + "\n");
    rec = { file, stream, since: Date.now(), rows: 0, stats: {} };
    ensureEngine().catch(() => {});
    ctx.emit("recording", { on: true, since: rec.since, file });
    updateKeepAlive();
    return file;
  }
  const num = (v) => (v == null || !isFinite(v) ? "" : String(Math.round(v * 100) / 100).replace(".", ","));
  function recordRow(s) {
    const vals = METRICS.map(([key, , get]) => {
      const v = get(s);
      if (v != null && isFinite(v)) {
        const st = rec.stats[key] || (rec.stats[key] = { min: v, max: v, sum: 0, n: 0 });
        st.min = Math.min(st.min, v); st.max = Math.max(st.max, v); st.sum += v; st.n++;
      }
      return num(v);
    });
    rec.stream.write([new Date(s.at || Date.now()).toLocaleTimeString("pt-BR"), (s.fps && s.fps.process) || "", ...vals].join(";") + "\n");
    rec.rows++;
  }
  function stopRecording() {
    if (!rec) return null;
    const r = rec;
    rec = null;
    r.stream.end();
    const summary = METRICS.filter(([k]) => r.stats[k]).map(([k, name]) => {
      const st = r.stats[k];
      return { key: k, name, min: st.min, avg: st.sum / st.n, max: st.max };
    });
    const result = { file: r.file, seconds: Math.round((Date.now() - r.since) / 1000), rows: r.rows, summary };
    ctx.emit("recording", { on: false, last: result });
    updateKeepAlive();
    scheduleIdleStop();
    return result;
  }

  // ---------------------------------------------------------------- overlay de jogo
  let overlayOpen = false;
  async function applyOverlay() {
    const o = settings.overlay;
    if (o.enabled) {
      await ensureEngine().catch(() => {});
      if (!overlayOpen) {
        await ctx.host.openWindow("overlay", { file: "web/overlay.html", width: 230, height: 160, frame: false, transparent: true, resizable: false,
          alwaysOnTop: true, topLevel: "screen-saver", skipTaskbar: true, focusable: false, hasShadow: false, clickThrough: true,
          fullscreenable: false, maximizable: false, minimizable: false, title: "Overlay InfoHardware" });
        overlayOpen = true;
      }
      await ctx.host.setWindowOpacity("overlay", o.opacity);
      ctx.host.sendToWindow("overlay", "config", o).catch(() => {});
      if (lastSnap) ctx.host.sendToWindow("overlay", "snap", lastSnap).catch(() => {});
      await ctx.host.showWindow("overlay", { placement: o.position, focus: false });
    } else if (overlayOpen) {
      await ctx.host.hideWindow("overlay");
      scheduleIdleStop();
    }
    updateKeepAlive();
  }
  // overlay ligado ou gravação em andamento: fechar a janela do Hub só o esconde
  const updateKeepAlive = () => ctx.host.keepAlive(settings.overlay.enabled || !!rec,
    settings.overlay.enabled ? "overlay do InfoHardware" : "gravação do InfoHardware").catch(() => {});

  // ---------------------------------------------------------------- atalhos
  const toggleOverlay = async () => { settings.overlay.enabled = !settings.overlay.enabled; save(); await applyOverlay(); ctx.emit("settings", settings); };
  const toggleRecording = () => (rec ? stopRecording() : startRecording());
  async function bindHotkeys() {
    const ok = [];
    for (const [key, fn] of [["overlay", toggleOverlay], ["record", toggleRecording]]) {
      const acc = settings.hotkeys[key];
      if (acc && (await ctx.host.registerHotkey(acc))) ok.push(acc);
      hotkeyActions[acc] = fn;
    }
    if (ok.length < 2) ctx.log("atalhos em uso por outro programa", settings.hotkeys);
  }
  const hotkeyActions = {};
  ctx.host.on("hotkey", (acc) => { const fn = hotkeyActions[acc]; if (fn) Promise.resolve(fn()).catch((e) => ctx.log("atalho", e)); });

  // ---------------------------------------------------------------- chamadas da interface
  ctx.handle("state", () => ({ engine, structure, snap: lastSnap, info, settings, recording: rec ? { on: true, since: rec.since, file: rec.file } : { on: false },
    metrics: METRICS.map(([k, n]) => [k, n]), sessionsDir: SESSIONS_DIR, version: ctx.version }));
  ctx.handle("start", () => ensureEngine());
  ctx.handle("elevate", async () => { uacDeclined = false; await stopEngine(); return ensureEngine({ forceAdmin: true }); });
  ctx.handle("info", () => { if (info) return info; send({ cmd: "info" }); return null; });
  ctx.handle("reset-minmax", () => send({ cmd: "reset" }));
  ctx.handle("settings", async (patch) => {
    settings = merge(settings, patch || {});
    settings.interval = Math.max(250, Math.min(5000, Number(settings.interval) || 1000));
    settings.overlay.opacity = Math.max(0.2, Math.min(1, Number(settings.overlay.opacity) || 0.85));
    settings.overlay.scale = Math.max(0.6, Math.min(2, Number(settings.overlay.scale) || 1));
    save();
    send({ cmd: "interval", ms: settings.interval });
    if (patch && patch.overlay) await applyOverlay();
    ctx.emit("settings", settings);
    return settings;
  });
  ctx.handle("overlay-size", async (w, h) => {
    await ctx.host.setWindowBounds("overlay", { width: Math.ceil(w), height: Math.ceil(h) });
    if (settings.overlay.enabled) await ctx.host.showWindow("overlay", { placement: settings.overlay.position, focus: false });
  });
  ctx.handle("record-start", () => startRecording());
  ctx.handle("record-stop", () => stopRecording());
  ctx.handle("open-sessions", () => { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); return ctx.host.openPath(SESSIONS_DIR); });
  ctx.handle("show-file", (f) => ctx.host.showItem(f));
  ctx.handle("export-report", async () => {
    if (!info) throw new Error("As informações do hardware ainda estão sendo lidas");
    const file = await ctx.host.saveDialog({ title: "Exportar relatório", defaultPath: path.join(os.homedir(), "Documents", `InfoHardware-${os.hostname()}.txt`),
      filters: [{ name: "Texto", extensions: ["txt"] }] });
    if (!file) return null;
    fs.writeFileSync(file, "﻿" + info.report, "utf8");
    return file;
  });
  // instala o PawnIO, ou reinstala quando os arquivos estão lá mas o driver não carregou ("broken")
  // instala o PawnIO, ou repara quando os arquivos estão lá mas o driver não carregou ("broken"):
  // uma janela de administrador (pawnio-fix.ps1) remove a instalação antiga, instala de novo e confere o driver
  ctx.handle("install-pawnio", async () => {
    const repair = engine.pawnIoState === "broken";
    const r = await ctx.host.messageBox({ type: "question", title: repair ? "Reparar o driver PawnIO" : "Instalar o driver PawnIO",
      message: repair ? "Reparar o driver PawnIO?" : "Instalar o driver PawnIO?",
      detail: (repair ? "Os arquivos do PawnIO estão no PC, mas o driver não está carregado no Windows, então a temperatura e o consumo da CPU não aparecem.\n\n"
        : "O PawnIO é o driver usado pelo LibreHardwareMonitor para ler temperatura e consumo da CPU, ventoinhas e tensões da placa-mãe.\n\n") +
        "Vai abrir uma janela de administrador (aceite o pedido do Windows) que remove a instalação antiga, instala o PawnIO de novo pelo winget e confere se o driver carregou. Ao terminar, clique em \"Reiniciar o motor\".",
      buttons: [repair ? "Reparar" : "Instalar", "Cancelar"], defaultId: 0, cancelId: 1 });
    if (r !== 0) return false;
    const script = path.join(ctx.dir, "pawnio-fix.ps1");
    const arg = `'"${script.replace(/'/g, "''")}"'`;
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${arg}`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  });
  ctx.handle("restart-engine", async () => { await stopEngine(); return ensureEngine(); });
  ctx.handle("bench-state", () => benchPublic());
  ctx.handle("bench-start", () => startBench());
  ctx.handle("bench-cancel", () => { send({ cmd: "benchCancel" }); return true; });
  // botões das dicas de melhoria (só coisas seguras, que a própria pessoa pede)
  ctx.handle("bench-action", async (id) => {
    if (id === "power-balanced") {
      require("child_process").execFileSync("powercfg.exe", ["/setactive", "381b4222-f694-41f0-9685-ff5bb260df2e"], { windowsHide: true });
      return "Plano de energia: Equilibrado";
    }
    if (id === "startup") { spawn("taskmgr.exe", ["/0", "/startup"], { detached: true, stdio: "ignore" }).unref(); return null; }
    if (id === "cleanmgr") { spawn("cleanmgr.exe", [], { detached: true, stdio: "ignore" }).unref(); return null; }
    throw new Error("Ação desconhecida");
  });

  // ---------------------------------------------------------------- início
  bindHotkeys().catch((e) => ctx.log("atalhos", e));
  if (settings.overlay.enabled) applyOverlay().catch((e) => ctx.log("overlay", e));
  ctx.onStop(async () => {
    if (rec) stopRecording();
    await stopEngine();
    await new Promise((r) => setTimeout(r, 500)); // o PowerShell do motor solta os arquivos ao sair
  });
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { return fallback; }
}
function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" ? merge(base[k], v) : v;
  }
  return out;
}
