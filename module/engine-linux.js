// InfoHardware · motor de sensores do Linux. Fala o mesmo protocolo do motor .NET do Windows (linhas JSON:
// hello, structure, snap, info, bench...), mas roda aqui mesmo, sem processo nem administrador:
//   CPU e RAM pelo /proc, temperaturas/ventoinhas/tensões pelo /sys/class/hwmon, GPU AMD/Intel pelo /sys/class/drm,
//   GPU NVIDIA pelo nvidia-smi, discos pelo /proc/diskstats e rede pelo /proc/net/dev.
// FPS de jogos não existe aqui (no Linux o caminho é o MangoHud). open() devolve um objeto com cara de socket.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { execFile } = require("child_process");

const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };
const num = (f, div = 1) => { const v = Number(read(f)); return read(f) !== "" && isFinite(v) ? v / div : null; };
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const run = (file, args, timeout = 4000) => new Promise((resolve) => execFile(file, args, { timeout, env: { ...process.env, LC_ALL: "C" } }, (err, out) => resolve(err ? "" : String(out))));

// ---------------------------------------------------------------- sensores do hwmon
const HW_TYPE = (name) => (/^(k10temp|coretemp|zenpower|cpu_thermal)$/.test(name) ? "Cpu" : name === "amdgpu" ? "GpuAmd" : name === "nouveau" ? "GpuNvidia"
  : /^(i915|xe)$/.test(name) ? "GpuIntel" : /^(nvme|drivetemp)$/.test(name) ? "Storage" : /^(nct|it8|w83|f71|asus|gigabyte|dell|thinkpad)/.test(name) ? "SuperIO"
  : /^(iwlwifi|mt7|ath|r8169)/.test(name) ? "Network" : /^(BAT|battery)/i.test(name) ? "Battery" : "Motherboard");
const KINDS = [ // prefixo do arquivo, tipo, divisor até a unidade da tela
  ["temp", "Temperature", 1000], ["fan", "Fan", 1], ["in", "Voltage", 1000], ["power", "Power", 1e6], ["freq", "Clock", 1e6], ["curr", "Current", 1000],
];
function hwmonChips() {
  const chips = [];
  for (const h of ls("/sys/class/hwmon")) {
    const dir = path.join("/sys/class/hwmon", h);
    const name = read(path.join(dir, "name")) || h;
    const files = ls(dir);
    const sensors = [];
    for (const f of files) {
      const m = /^(temp|fan|in|power|freq|curr)(\d+)_(input|average)$/.exec(f);
      if (!m) continue;
      if (m[3] === "average" && files.includes(`${m[1]}${m[2]}_input`)) continue;
      const [, type, div] = KINDS.find((k) => k[0] === m[1]);
      const label = read(path.join(dir, `${m[1]}${m[2]}_label`)) || `${{ Temperature: "Temperatura", Fan: "Ventoinha", Voltage: "Tensão", Power: "Potência", Clock: "Clock", Current: "Corrente" }[type]} #${m[2]}`;
      sensors.push({ id: `/hwmon/${h}/${m[1]}${m[2]}`, name: label, type, index: Number(m[2]) - 1, file: path.join(dir, f), div: type === "Clock" ? 1e6 : div });
    }
    if (sensors.length) chips.push({ dir, hw: h, name: name, type: HW_TYPE(name), sensors, device: (() => { try { return fs.realpathSync(path.join(dir, "device")); } catch { return ""; } })() });
  }
  return chips;
}

// ---------------------------------------------------------------- CPU
function cpuTimes() {
  const out = {};
  for (const l of read("/proc/stat").split("\n")) {
    const m = /^(cpu\d*)\s+(.*)$/.exec(l); if (!m) continue;
    const f = m[2].split(/\s+/).map(Number);
    const idle = f[3] + (f[4] || 0), total = f.slice(0, 8).reduce((a, b) => a + b, 0);
    out[m[1]] = { idle, total };
  }
  return out;
}
function cpuName() { const m = /^model name\s*:\s*(.+)$/m.exec(read("/proc/cpuinfo")); return m ? m[1].trim() : (os.cpus()[0] || {}).model || "Processador"; }
function cpuClock() {
  const f = ls("/sys/devices/system/cpu").filter((d) => /^cpu\d+$/.test(d)).map((d) => num(`/sys/devices/system/cpu/${d}/cpufreq/scaling_cur_freq`, 1000)).filter((v) => v != null);
  if (f.length) return Math.max(...f);
  const mhz = [...read("/proc/cpuinfo").matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((m) => Number(m[1]));
  return mhz.length ? Math.max(...mhz) : null;
}
// consumo do processador pelo RAPL (Intel e AMD recentes); em muitos kernels só o administrador lê
function raplEnergy() { const v = num("/sys/class/powercap/intel-rapl:0/energy_uj"); return v == null ? null : v; }

// ---------------------------------------------------------------- GPU
function drmCards() {
  return ls("/sys/class/drm").filter((d) => /^card\d+$/.test(d)).map((d) => {
    const dev = fs.realpathSync(`/sys/class/drm/${d}/device`);
    const vendor = read(`${dev}/vendor`);
    return { card: d, dev, vendor: vendor === "0x1002" ? "amd" : vendor === "0x10de" ? "nvidia" : vendor === "0x8086" ? "intel" : "" };
  }).filter((c) => c.vendor);
}
async function nvidia() {
  const q = "name,utilization.gpu,temperature.gpu,clocks.gr,clocks.mem,power.draw,fan.speed,memory.used,memory.total";
  const out = await run("nvidia-smi", [`--query-gpu=${q}`, "--format=csv,noheader,nounits"]);
  const l = out.split("\n")[0]; if (!l) return null;
  const f = l.split(",").map((s) => s.trim()), n = (i) => (isFinite(Number(f[i])) && f[i] !== "" ? Number(f[i]) : null);
  return { name: f[0], load: n(1), temp: n(2), clock: n(3), memClock: n(4), power: n(5), fanPct: n(6), vramUsed: n(7), vramTotal: n(8) };
}
let pciNames = null;
async function gpuNames() {
  if (pciNames) return pciNames;
  pciNames = {};
  for (const l of (await run("lspci", ["-mm", "-nn"])).split("\n")) {
    const m = /^(\S+) "(VGA compatible controller|3D controller|Display controller)[^"]*" "([^"]*)" "([^"]*)"/.exec(l);
    if (m) pciNames[m[1]] = `${m[3].replace(/\s*\[[0-9a-f]{4}\]$/, "").replace(/Advanced Micro Devices, Inc\. \[AMD\/ATI\]/, "AMD").replace(/ Corporation/, "")} ${m[4].replace(/\s*\[[0-9a-f]{4}\]$/, "")}`;
  }
  return pciNames;
}

// ---------------------------------------------------------------- discos e rede
const WHOLE_DISK = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|mmcblk\d+|hd[a-z]+)$/;
function diskStats() {
  let r = 0, w = 0, busy = 0;
  for (const l of read("/proc/diskstats").split("\n")) {
    const f = l.trim().split(/\s+/); if (f.length < 14 || !WHOLE_DISK.test(f[2])) continue;
    r += Number(f[5]) * 512; w += Number(f[9]) * 512; busy = Math.max(busy, Number(f[12]));
  }
  return { r, w, busy };
}
function netStats() {
  let rx = 0, tx = 0;
  for (const l of read("/proc/net/dev").split("\n").slice(2)) {
    const m = /^\s*([^:]+):\s*(.*)$/.exec(l); if (!m || m[1] === "lo" || /^(docker|veth|br-|virbr)/.test(m[1])) continue;
    const f = m[2].trim().split(/\s+/).map(Number); rx += f[0]; tx += f[8];
  }
  return { rx, tx };
}
function memInfo() {
  const m = {}; for (const l of read("/proc/meminfo").split("\n")) { const x = /^(\w+):\s+(\d+)/.exec(l); if (x) m[x[1]] = Number(x[2]) * 1024; }
  const total = m.MemTotal || os.totalmem(), avail = m.MemAvailable != null ? m.MemAvailable : os.freemem();
  return { total, avail, used: total - avail };
}

// ---------------------------------------------------------------- o motor
class LinuxEngine extends EventEmitter {
  constructor() { super(); this.writable = true; this.interval = 1000; this.minmax = new Map(); this.timer = null; this.prev = null; this.bench = null; }
  setEncoding() { /* compatível com socket */ }
  out(obj) { setImmediate(() => this.emit("data", JSON.stringify(obj) + "\n")); }
  write(line) { for (const l of String(line).split("\n")) if (l.trim()) { try { this.cmd(JSON.parse(l)); } catch (e) { this.out({ t: "error", message: e.message }); } } return true; }
  destroy() { if (!this.writable) return; this.writable = false; clearTimeout(this.timer); if (this.bench) this.bench.cancel(); setImmediate(() => this.emit("close")); }

  async start() {
    this.chips = hwmonChips();
    this.cards = drmCards();
    this.names = await gpuNames().catch(() => ({}));
    this.nv = this.cards.some((c) => c.vendor === "nvidia") ? await nvidia() : null;
    this.cpu = cpuName();
    // no Linux os sensores não precisam de administrador nem do PawnIO: aparece como modo completo
    this.out({ t: "hello", admin: true, fps: false, fpsError: "No Linux o FPS é medido pelo MangoHud (sudo apt install mangohud).", pawnIo: true, pawnIoState: "ok", linux: true, version: "linux" });
    this.out({ t: "structure", groups: this.structure() });
    this.tick();
  }
  structure() {
    const cores = os.cpus().length;
    const groups = [{ name: this.cpu, type: "Cpu", sensors: [{ id: "/cpu/load", name: "Uso total", type: "Load", index: 0 }, { id: "/cpu/clock", name: "Clock (maior núcleo)", type: "Clock", index: 0 },
      ...(raplEnergy() != null ? [{ id: "/cpu/power", name: "Pacote", type: "Power", index: 0 }] : []),
      ...Array.from({ length: cores }, (_, i) => ({ id: `/cpu/load${i}`, name: `Núcleo #${i + 1}`, type: "Load", index: i + 1 }))] },
    { name: "Memória", type: "Memory", sensors: [{ id: "/ram/load", name: "Memória", type: "Load", index: 0 }, { id: "/ram/used", name: "Memória usada", type: "Data", index: 0 }, { id: "/ram/avail", name: "Memória disponível", type: "Data", index: 1 }] }];
    if (this.nv) groups.push({ name: this.nv.name, type: "GpuNvidia", sensors: [["load", "GPU", "Load"], ["temp", "GPU", "Temperature"], ["clock", "Núcleo", "Clock"], ["memClock", "Memória", "Clock"],
      ["power", "GPU", "Power"], ["fanPct", "Ventoinha", "Control"], ["vramUsed", "VRAM usada", "SmallData"]].map(([k, n, t], i) => ({ id: `/nvidia/${k}`, name: n, type: t, index: i })) });
    for (const c of this.cards.filter((x) => x.vendor === "amd" && fs.existsSync(`${x.dev}/gpu_busy_percent`)))
      groups.push({ name: this.gpuName(c), type: "GpuAmd", sensors: [{ id: `/drm/${c.card}/load`, name: "GPU", type: "Load", index: 0 }, { id: `/drm/${c.card}/vram`, name: "VRAM usada", type: "SmallData", index: 0 }] });
    for (const ch of this.chips) groups.push({ name: ch.type === "GpuAmd" ? this.gpuName(this.cards.find((c) => c.dev === ch.device) || {}) || ch.name : ch.type === "Cpu" ? `${this.cpu} (${ch.name})` : ch.name,
      type: ch.type, sensors: ch.sensors.map(({ id, name, type, index }) => ({ id, name, type, index })) });
    groups.push({ name: "Discos", type: "Storage", sensors: [{ id: "/disk/read", name: "Leitura", type: "Throughput", index: 0 }, { id: "/disk/write", name: "Escrita", type: "Throughput", index: 1 }, { id: "/disk/act", name: "Atividade", type: "Load", index: 0 }] });
    groups.push({ name: "Rede", type: "Network", sensors: [{ id: "/net/down", name: "Download", type: "Throughput", index: 0 }, { id: "/net/up", name: "Upload", type: "Throughput", index: 1 }] });
    return groups;
  }
  gpuName(c) { if (!c || !c.dev) return ""; return this.names[path.basename(c.dev).replace(/^0000:/, "")] || this.names[path.basename(c.dev)] || ({ amd: "GPU AMD", intel: "GPU Intel", nvidia: "GPU NVIDIA" }[c.vendor] || "GPU"); }

  async tick() {
    if (!this.writable) return;
    const t0 = Date.now();
    try { this.out(await this.sample()); } catch (e) { this.out({ t: "error", message: e.message }); }
    this.timer = setTimeout(() => this.tick(), Math.max(100, this.interval - (Date.now() - t0)));
  }
  async sample() {
    const now = Date.now(), cur = { cpu: cpuTimes(), disk: diskStats(), net: netStats(), rapl: raplEnergy(), at: now }, p = this.prev;
    this.prev = cur;
    const sensors = {};
    const put = (id, v) => {
      if (v == null || !isFinite(v)) return;
      const mm = this.minmax.get(id) || { min: v, max: v };
      mm.min = Math.min(mm.min, v); mm.max = Math.max(mm.max, v); this.minmax.set(id, mm);
      sensors[id] = [v, mm.min, mm.max];
    };
    const dt = p ? (now - p.at) / 1000 : 0;
    const load = (k) => { if (!p || !p.cpu[k] || !cur.cpu[k]) return null; const dT = cur.cpu[k].total - p.cpu[k].total, dI = cur.cpu[k].idle - p.cpu[k].idle; return dT > 0 ? Math.max(0, Math.min(100, (1 - dI / dT) * 100)) : null; };
    const coreLoads = os.cpus().map((_, i) => load("cpu" + i));
    const hw = { cpuName: this.cpu, gpuName: "", cpuLoad: load("cpu"), cpuTemp: null, cpuClock: cpuClock(), cpuPower: p && p.rapl != null && cur.rapl != null && dt > 0 && cur.rapl >= p.rapl ? (cur.rapl - p.rapl) / 1e6 / dt : null,
      coreLoads, gpuLoad: null, gpuTemp: null, gpuHotspot: null, gpuClock: null, gpuMemClock: null, gpuPower: null, gpuFan: null, vramUsedMb: null, vramTotalMb: null,
      ramUsedGb: null, ramAvailableGb: null, ramLoad: null, diskRead: p && dt ? (cur.disk.r - p.disk.r) / dt : null, diskWrite: p && dt ? (cur.disk.w - p.disk.w) / dt : null,
      diskTemp: null, diskActivity: p && dt ? Math.min(100, (cur.disk.busy - p.disk.busy) / (dt * 10)) : null, netUp: p && dt ? (cur.net.tx - p.net.tx) / dt : null, netDown: p && dt ? (cur.net.rx - p.net.rx) / dt : null };
    put("/cpu/load", hw.cpuLoad); put("/cpu/clock", hw.cpuClock); put("/cpu/power", hw.cpuPower);
    coreLoads.forEach((v, i) => put(`/cpu/load${i}`, v));
    const m = memInfo();
    hw.ramUsedGb = m.used / 1073741824; hw.ramAvailableGb = m.avail / 1073741824; hw.ramLoad = (m.used / m.total) * 100;
    put("/ram/load", hw.ramLoad); put("/ram/used", hw.ramUsedGb); put("/ram/avail", hw.ramAvailableGb);
    // hwmon: a temperatura do processador é o Tctl/Package (ou a primeira do chip da CPU)
    for (const ch of this.chips) for (const s of ch.sensors) {
      const v = num(s.file, s.div);
      put(s.id, v);
      if (v == null) continue;
      if (ch.type === "Cpu" && s.type === "Temperature" && (hw.cpuTemp == null || /tctl|package|tdie/i.test(s.name))) hw.cpuTemp = v;
      if (ch.type === "Storage" && s.type === "Temperature" && hw.diskTemp == null) hw.diskTemp = v;
      if (ch.type === "GpuAmd") {
        if (s.type === "Temperature" && (/edge/i.test(s.name) || hw.gpuTemp == null && !/junction|hotspot|mem/i.test(s.name))) hw.gpuTemp = v;
        if (s.type === "Temperature" && /junction|hotspot/i.test(s.name)) hw.gpuHotspot = v;
        if (s.type === "Power" && hw.gpuPower == null) hw.gpuPower = v;
        if (s.type === "Clock" && /sclk/i.test(s.name)) hw.gpuClock = v;
        if (s.type === "Clock" && /mclk/i.test(s.name)) hw.gpuMemClock = v;
        if (s.type === "Fan") hw.gpuFan = v;
      }
    }
    for (const c of this.cards.filter((x) => x.vendor === "amd")) {
      const busy = num(`${c.dev}/gpu_busy_percent`), used = num(`${c.dev}/mem_info_vram_used`, 1048576), total = num(`${c.dev}/mem_info_vram_total`, 1048576);
      put(`/drm/${c.card}/load`, busy); put(`/drm/${c.card}/vram`, used);
      if (busy != null && hw.gpuLoad == null) { hw.gpuLoad = busy; hw.vramUsedMb = used; hw.vramTotalMb = total; hw.gpuName = this.gpuName(c); }
    }
    if (this.nv) {
      const n = await nvidia();
      if (n) {
        for (const k of ["load", "temp", "clock", "memClock", "power", "fanPct", "vramUsed"]) put(`/nvidia/${k}`, n[k]);
        Object.assign(hw, { gpuName: n.name, gpuLoad: n.load, gpuTemp: n.temp, gpuClock: n.clock, gpuMemClock: n.memClock, gpuPower: n.power, vramUsedMb: n.vramUsed, vramTotalMb: n.vramTotal });
      }
    }
    if (!hw.gpuName) { const c = this.cards[0]; hw.gpuName = c ? this.gpuName(c) : ""; }
    put("/disk/read", hw.diskRead); put("/disk/write", hw.diskWrite); put("/disk/act", hw.diskActivity);
    put("/net/down", hw.netDown); put("/net/up", hw.netUp);
    return { t: "snap", at: new Date(now).toISOString(), hw, sensors, fps: null, error: null };
  }

  cmd(c) {
    switch (c.cmd) {
      case "interval": this.interval = Math.max(250, Math.min(5000, Number(c.ms) || 1000)); clearTimeout(this.timer); this.tick(); break;
      case "reset": this.minmax.clear(); break;
      case "info": collectInfo(this).then((r) => this.out({ t: "info", ...r }), (e) => this.out({ t: "error", message: e.message })); break;
      case "checks": checks().then((facts) => this.out({ t: "checks", facts })); break;
      case "bench": this.runBench(); break;
      case "benchCancel": if (this.bench) this.bench.cancel(); break;
      case "pawnio": case "pawnioUi": this.out({ t: "pawnioDone", ok: false, reason: "linux", detail: "O PawnIO é só do Windows. No Linux os sensores vêm do kernel (lm-sensors)." }); break;
      case "quit": this.destroy(); break;
    }
  }

  runBench() {
    if (this.bench) return;
    let canceled = false;
    const workers = new Set();
    this.bench = { cancel: () => { canceled = true; for (const w of workers) w.terminate(); } };
    const { Worker } = require("worker_threads");
    const job = (kind, ms) => new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, "bench-worker.js"), { workerData: { kind, ms } });
      workers.add(w);
      w.once("message", (r) => { workers.delete(w); resolve(r); });
      w.once("error", reject);
      w.once("exit", () => { workers.delete(w); if (canceled) resolve(null); });
    });
    const phase = async (name, ms, fn) => {
      const t0 = Date.now();
      this.out({ t: "bench", phase: name, pct: 0 });
      const tm = setInterval(() => this.out({ t: "bench", phase: name, pct: Math.min(1, (Date.now() - t0) / ms) }), 250);
      try { return await fn(); } finally { clearInterval(tm); }
    };
    (async () => {
      const t0 = Date.now(), threads = os.cpus().length;
      const single = await phase("single", 4000, () => job("cpu", 4000));
      if (canceled) return this.out({ t: "benchCanceled" });
      const multi = await phase("multi", 5000, () => Promise.all(Array.from({ length: threads }, () => job("cpu", 5000))));
      if (canceled) return this.out({ t: "benchCanceled" });
      const mem = await phase("memory", 3000, () => job("memory", 3000));
      if (canceled) return this.out({ t: "benchCanceled" });
      this.out({ t: "benchDone", result: { single, multi: multi.reduce((a, b) => a + (b || 0), 0), threads, memoryGBs: mem, durationMs: Date.now() - t0 } });
    })().catch((e) => this.out({ t: "benchError", message: e.message })).finally(() => { this.bench = null; });
  }
}

// ---------------------------------------------------------------- dados para as dicas do teste de desempenho
async function checks() {
  const f = { memory: [], gpus: [] };
  try {
    const st = fs.statfsSync("/");
    f.systemDrive = { letter: "/", freeGB: (st.bavail * st.bsize) / 1073741824, totalGB: (st.blocks * st.bsize) / 1073741824 };
  } catch { /* Node antigo */ }
  const lsblk = await run("lsblk", ["-J", "-d", "-o", "NAME,MODEL,ROTA,TRAN"]);
  try {
    const root = (await run("findmnt", ["-n", "-o", "SOURCE", "/"])).trim().replace(/^\/dev\//, "").replace(/p?\d+$/, "");
    const d = JSON.parse(lsblk).blockdevices.find((x) => root.startsWith(x.name)) || {};
    f.systemDisk = { name: (d.model || "").trim(), media: d.rota === true || d.rota === "1" ? "HDD" : d.rota != null ? "SSD" : "", bus: d.tran === "nvme" ? "NVMe" : d.tran === "sata" ? "SATA" : d.tran === "usb" ? "USB" : "" };
  } catch { /* sem lsblk */ }
  f.startupApps = ls(path.join(os.homedir(), ".config", "autostart")).filter((x) => x.endsWith(".desktop")).length;
  for (const name of Object.values(await gpuNames().catch(() => ({})))) f.gpus.push({ name, driver: "", driverDate: null });
  return f;
}

// ---------------------------------------------------------------- tela Hardware (informações fixas)
const fmtBytes = (b) => (b >= 1099511627776 ? (b / 1099511627776).toFixed(1) + " TB" : b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : (b / 1048576).toFixed(0) + " MB");
const uptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? `${d}d ` : "") + `${h}h ${m}min`; };
function section(title, glyph, subtitle = "") { const s = { title, glyph, subtitle, groups: [] }; s.group = (header = null) => { const g = { header, hasHeader: !!header, items: [] }; g.add = (label, value) => { if (value != null && String(value).trim()) g.items.push({ label, value: String(value).trim() }); return g; }; s.groups.push(g); return g; }; return s; }
const clean = (s) => String(s || "").replace(/^(To be filled by O\.E\.M\.|Default string|System Product Name|Not Specified|None)$/i, "").trim();
async function collectInfo(engine) {
  const summary = { cpu: "--", gpu: "--", ram: "--", os: "--", board: "--", computer: os.hostname(), ramTotalGb: 0 };
  const osr = Object.fromEntries(read("/etc/os-release").split("\n").map((l) => /^(\w+)="?(.*?)"?$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  const sys = section("Sistema", "");
  summary.os = osr.PRETTY_NAME || "Linux";
  sys.group("Sistema operacional").add("Distribuição", osr.PRETTY_NAME).add("Kernel", os.release()).add("Arquitetura", os.arch())
    .add("Área de trabalho", process.env.XDG_CURRENT_DESKTOP).add("Sessão", process.env.XDG_SESSION_TYPE).add("Tempo ligado", uptime(os.uptime()));
  const dmi = (k) => clean(read(`/sys/class/dmi/id/${k}`));
  sys.group("Computador").add("Nome", os.hostname()).add("Usuário", os.userInfo().username).add("Fabricante", dmi("sys_vendor")).add("Modelo", dmi("product_name"));
  const cpuinfo = read("/proc/cpuinfo"), ci = (k) => (new RegExp(`^${k}\\s*:\\s*(.+)$`, "m").exec(cpuinfo) || [])[1];
  const cpu = section("Processador", "");
  const lscpu = Object.fromEntries((await run("lscpu", [])).split("\n").map((l) => /^([^:]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1].trim(), m[2].trim()]));
  summary.cpu = engine.cpu;
  cpu.group(engine.cpu).add("Fabricante", ci("vendor_id")).add("Núcleos", lscpu["Core(s) per socket"] && lscpu["Socket(s)"] ? Number(lscpu["Core(s) per socket"]) * Number(lscpu["Socket(s)"]) : "")
    .add("Threads", os.cpus().length).add("Clock máximo", lscpu["CPU max MHz"] ? Math.round(Number(lscpu["CPU max MHz"])) + " MHz" : "").add("Arquitetura", lscpu.Architecture)
    .add("Cache L2", lscpu["L2 cache"]).add("Cache L3", lscpu["L3 cache"]).add("Virtualização", lscpu.Virtualization);
  const flags = (ci("flags") || "").split(" ");
  const ext = ["sse4_2", "avx", "avx2", "avx512f", "aes", "sha_ni", "fma"].filter((x) => flags.includes(x)).map((x) => x.toUpperCase().replace("_NI", "").replace("SSE4_2", "SSE4.2").replace("AVX512F", "AVX-512"));
  if (ext.length) cpu.group("Instruções").add("Suportadas", ext.join("  ·  "));
  const board = section("Placa-mãe", "");
  summary.board = [dmi("board_vendor"), dmi("board_name")].filter(Boolean).join(" ") || "--";
  board.group("Placa").add("Fabricante", dmi("board_vendor")).add("Modelo", dmi("board_name")).add("Revisão", dmi("board_version"));
  board.group("BIOS").add("Fabricante", dmi("bios_vendor")).add("Versão", dmi("bios_version")).add("Data", dmi("bios_date"));
  const mem = memInfo();
  summary.ramTotalGb = mem.total / 1073741824; summary.ram = fmtBytes(mem.total);
  const memS = section("Memória", "");
  memS.group().add("Total", fmtBytes(mem.total)).add("Em uso", fmtBytes(mem.used)).add("Disponível", fmtBytes(mem.avail));
  const gpus = section("Placas de vídeo", "");
  const names = await gpuNames().catch(() => ({}));
  for (const [slot, name] of Object.entries(names)) gpus.group(name).add("Slot PCI", slot).add("Driver", (() => { try { return path.basename(fs.realpathSync(`/sys/bus/pci/devices/0000:${slot}/driver`)); } catch { return ""; } })());
  if (engine.nv) gpus.groups.forEach((g) => { if (/nvidia/i.test(g.header)) g.add("VRAM", engine.nv.vramTotal ? engine.nv.vramTotal + " MB" : ""); });
  summary.gpu = Object.values(names)[0] || "--";
  const disks = section("Armazenamento", "");
  try {
    for (const d of JSON.parse(await run("lsblk", ["-J", "-b", "-d", "-o", "NAME,MODEL,SIZE,ROTA,TRAN,SERIAL"])).blockdevices || []) {
      if (/^(loop|zram|sr)/.test(d.name)) continue;
      disks.group((d.model || d.name).trim()).add("Dispositivo", "/dev/" + d.name).add("Tamanho", fmtBytes(Number(d.size))).add("Tipo", d.rota === true || d.rota === "1" ? "HDD" : "SSD")
        .add("Conexão", d.tran ? String(d.tran).toUpperCase() : "");
    }
  } catch { /* sem lsblk */ }
  const netS = section("Rede", "");
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name === "lo") continue;
    netS.group(name).add("MAC", read(`/sys/class/net/${name}/address`)).add("IPv4", addrs.filter((a) => a.family === "IPv4").map((a) => a.address).join(", "))
      .add("Velocidade", num(`/sys/class/net/${name}/speed`) > 0 ? num(`/sys/class/net/${name}/speed`) + " Mb/s" : "");
  }
  const sections = [sys, cpu, board, memS, gpus, disks, netS];
  const bat = ls("/sys/class/power_supply").find((b) => /^BAT/.test(b));
  if (bat) { const b = section("Bateria", ""); const d = `/sys/class/power_supply/${bat}`; b.group().add("Carga", read(`${d}/capacity`) + " %").add("Estado", read(`${d}/status`)).add("Modelo", read(`${d}/model_name`)); sections.push(b); }
  const plain = sections.map(({ title, glyph, subtitle, groups }) => ({ title, glyph, subtitle, groups: groups.filter((g) => g.items.length).map(({ header, hasHeader, items }) => ({ header, hasHeader, items })) }));
  const report = ["==============================================", "  INFOHARDWARE — RELATÓRIO DO SISTEMA", `  Gerado em ${new Date().toLocaleString("pt-BR")}`, "==============================================",
    ...plain.flatMap((s) => ["", `### ${s.title.toUpperCase()}`, ...s.groups.flatMap((g) => [...(g.header ? [`  [${g.header}]`] : []), ...g.items.map((i) => `    ${i.label}: ${i.value}`)])])].join("\n");
  return { sections: plain, summary, report };
}

function open() { const e = new LinuxEngine(); e.start().catch((err) => e.out({ t: "error", message: err.message })); return e; }

module.exports = { open, hwmonChips, collectInfo, LinuxEngine };
