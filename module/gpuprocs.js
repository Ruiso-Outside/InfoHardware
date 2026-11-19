// Gerenciador de tarefas da GPU: quais programas estão usando a placa de vídeo, quanto de GPU e de memória de vídeo.
//
//   NVIDIA (Linux e Windows)  nvidia-smi pmon: uso dos núcleos (SM), memória, codificador/decodificador e VRAM por processo
//   AMD / Intel (Linux)       /proc/<pid>/fdinfo (chaves drm-*): tempo de cada motor e memória por processo
//   Windows (qualquer placa)  contadores "GPU Engine" e "GPU Process Memory" (os mesmos do Gerenciador de Tarefas)
//
// Só lê. Encerrar um processo é uma ação separada (kill), feita só com confirmação na tela.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const IS_WIN = process.platform === "win32";
const run = (file, args, timeout = 8000) => new Promise((resolve) =>
  execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: "C.UTF-8" } },
    (err, out) => resolve(err ? null : String(out))));
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };

// ---------------------------------------------------------------- dados do processo (Linux)
const MY_UID = IS_WIN ? null : os.userInfo().uid;
const SESSION = new Set(["Xorg", "Xwayland", "gnome-shell", "kwin_wayland", "kwin_x11", "plasmashell", "mutter", "gdm-x-session", "gdm-wayland-session"]);
function procInfo(pid) {
  if (IS_WIN) return {};
  const comm = read(`/proc/${pid}/comm`).trim();
  let cmd = read(`/proc/${pid}/cmdline`).split("\0").filter(Boolean);
  if (cmd.length === 1 && cmd[0].includes(" --")) cmd = cmd[0].split(" "); // Chromium/Electron reescrevem a linha de comando num texto só
  let exe = "";
  try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch { /* de outro usuário */ }
  const uid = num((/^Uid:\s+(\d+)/m.exec(read(`/proc/${pid}/status`)) || [])[1]);
  // nome amigável: o executável (ex.: "brave" em vez de "brave --type=gpu-process ...")
  let name = path.basename(exe || cmd[0] || comm || String(pid));
  let role = "";
  const type = (cmd.find((a) => a.startsWith("--type=")) || "").slice(7); // processos do Chromium/Electron
  if (type) role = `processo ${type}`;
  // jogos e programas do Windows (Wine/Proton): o nome do .exe em vez de "wine64-preloader"
  if (/^(wine|wine64|wine-preloader|wine64-preloader|wineserver)$/.test(name) || /\.exe$/i.test(comm)) {
    const win = cmd.find((a) => /\.exe$/i.test(a));
    if (win) { name = win.split(/[\\/]/).pop(); role = /proton/i.test(cmd.join(" ") + read(`/proc/${pid}/environ`).slice(0, 20000)) ? "Proton (Steam)" : "Wine"; }
  }
  // encerrar estes derruba a sessão gráfica inteira
  const session = SESSION.has(comm) || SESSION.has(name);
  return { name, comm, cmd: cmd.join(" ").slice(0, 400), exe, role, own: uid === MY_UID && !session, session, uid };
}

// ---------------------------------------------------------------- NVIDIA (nvidia-smi)
async function nvidiaGpus() {
  const out = await run("nvidia-smi", ["--query-gpu=index,name,utilization.gpu,memory.used,memory.total,utilization.encoder,utilization.decoder,temperature.gpu", "--format=csv,noheader,nounits"]);
  if (!out) return null;
  return out.trim().split("\n").filter(Boolean).map((l) => {
    const f = l.split(",").map((s) => s.trim());
    return { id: `nvidia:${f[0]}`, index: Number(f[0]), vendor: "nvidia", name: f[1], load: num(f[2]), vramUsedMb: num(f[3]), vramTotalMb: num(f[4]),
      enc: num(f[5]), dec: num(f[6]), temp: num(f[7]) };
  });
}
async function nvidiaProcs() {
  // pmon junta os processos gráficos (G) e de computação (C); -s um = uso + memória
  const out = await run("nvidia-smi", ["pmon", "-c", "1", "-s", "um"], 10000);
  if (!out) return [];
  const lines = out.split("\n");
  const head = (lines.find((l) => l.startsWith("#") && /\bpid\b/.test(l)) || "").replace(/^#\s*/, "").trim().split(/\s+/);
  const col = (n) => head.indexOf(n);
  const procs = [];
  for (const l of lines) {
    if (!l.trim() || l.startsWith("#")) continue;
    const f = l.trim().split(/\s+/);
    const pid = Number(f[col("pid")]);
    if (!pid) continue;
    const v = (n) => (col(n) >= 0 && f[col(n)] !== "-" ? num(f[col(n)]) : null);
    procs.push({ pid, gpu: `nvidia:${f[col("gpu")]}`, type: f[col("type")] === "C" ? "computação" : f[col("type")] === "C+G" ? "gráfico + computação" : "gráfico",
      gpuPct: v("sm"), memPct: v("mem"), enc: v("enc"), dec: v("dec"), vramMb: v("fb"), name: f.slice(Math.max(col("command"), 0)).join(" ") });
  }
  return procs;
}

// ---------------------------------------------------------------- AMD / Intel (fdinfo do kernel)
let prevFd = new Map(); // "pid|cliente|motor" -> ns, e o horário da leitura anterior
let prevAt = 0;
function drmCards() {
  const cards = {};
  for (const d of fs.readdirSync("/sys/class/drm").filter((x) => /^card\d+$/.test(x))) {
    try {
      const dev = fs.realpathSync(`/sys/class/drm/${d}/device`);
      const vendor = read(`${dev}/vendor`).trim();
      const v = vendor === "0x1002" ? "amd" : vendor === "0x8086" ? "intel" : vendor === "0x10de" ? "nvidia" : "";
      cards[path.basename(dev)] = { card: d, vendor: v, total: num(read(`${dev}/mem_info_vram_total`).trim()), used: num(read(`${dev}/mem_info_vram_used`).trim()),
        busy: num(read(`${dev}/gpu_busy_percent`).trim()) };
    } catch { /* placa sem device */ }
  }
  return cards;
}
const toMb = (s) => { const m = /^(\d+)\s*(\w+)?/.exec(s || ""); if (!m) return 0; const k = { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]] ?? 1 / 1048576; return Number(m[1]) * k; };
function fdinfoProcs() {
  const now = Date.now();
  const dt = prevAt ? (now - prevAt) * 1e6 : 0; // ns
  const next = new Map();
  const byPid = new Map();
  for (const pidS of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    let fds;
    try { fds = fs.readdirSync(`/proc/${pidS}/fdinfo`); } catch { continue; }
    const seen = new Set(); // o mesmo cliente aparece em vários fds
    for (const fd of fds) {
      const t = read(`/proc/${pidS}/fdinfo/${fd}`);
      if (!t.includes("drm-driver")) continue;
      const kv = {};
      for (const l of t.split("\n")) { const m = /^(drm-[\w-]+):\s*(.*)$/.exec(l); if (m) kv[m[1]] = m[2].trim(); }
      const client = kv["drm-client-id"] || fd;
      if (seen.has(client)) continue;
      seen.add(client);
      const pid = Number(pidS);
      const pdev = kv["drm-pdev"] || "";
      const p = byPid.get(pid) || { pid, gpu: pdev, driver: kv["drm-driver"], engines: {}, vramMb: 0, gttMb: 0 };
      for (const [k, v] of Object.entries(kv)) {
        const e = /^drm-engine-(.+)$/.exec(k);
        if (e && !/capacity/.test(e[1])) {
          const ns = Number(String(v).split(/\s/)[0]);
          const key = `${pid}|${client}|${e[1]}`;
          next.set(key, ns);
          if (dt && prevFd.has(key)) {
            const cap = Number(kv[`drm-engine-capacity-${e[1]}`]) || 1;
            const pct = Math.max(0, Math.min(100, ((ns - prevFd.get(key)) / dt) * 100 / cap));
            p.engines[e[1]] = Math.max(p.engines[e[1]] || 0, pct);
          }
        }
        if (/^drm-(memory|resident|total)-vram/.test(k)) p.vramMb = Math.max(p.vramMb, toMb(v));
        if (/^drm-(memory|resident|total)-gtt/.test(k)) p.gttMb = Math.max(p.gttMb, toMb(v));
      }
      byPid.set(pid, p);
    }
  }
  prevFd = next;
  prevAt = now;
  return [...byPid.values()].map((p) => {
    const eng = Object.values(p.engines);
    return { pid: p.pid, gpu: `pci:${p.gpu}`, type: Object.keys(p.engines).join(", ") || "gráfico", engines: p.engines,
      gpuPct: eng.length ? Math.max(...eng) : null, vramMb: Math.round(p.vramMb) || null, gttMb: Math.round(p.gttMb) || null };
  });
}

// ---------------------------------------------------------------- Windows (contadores de desempenho)
const WIN_PS = `$ErrorActionPreference='SilentlyContinue'
$e = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples
$m = (Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples
$out = @{ eng = @($e | ForEach-Object { @{ i = $_.InstanceName; v = $_.CookedValue } }); mem = @($m | ForEach-Object { @{ i = $_.InstanceName; v = $_.CookedValue } });
  procs = @(Get-Process | Select-Object Id, ProcessName, Path, MainWindowTitle) ;
  gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM) }
$out | ConvertTo-Json -Depth 4 -Compress`;
async function windowsProcs() {
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS], 15000);
  if (!out) return { gpus: [], procs: [] };
  let d;
  try { d = JSON.parse(out); } catch { return { gpus: [], procs: [] }; }
  const names = new Map((d.procs || []).map((p) => [p.Id, p]));
  const byPid = new Map();
  const get = (pid) => byPid.get(pid) || byPid.set(pid, { pid, engines: {}, vramMb: 0 }).get(pid);
  for (const s of d.eng || []) {
    const m = /pid_(\d+)_.*engtype_(.+)$/i.exec(s.i || "");
    if (!m) continue;
    const p = get(Number(m[1]));
    p.engines[m[2]] = (p.engines[m[2]] || 0) + (s.v || 0);
  }
  for (const s of d.mem || []) {
    const m = /pid_(\d+)_/i.exec(s.i || "");
    if (m) get(Number(m[1])).vramMb += (s.v || 0) / 1048576;
  }
  const procs = [...byPid.values()].filter((p) => p.vramMb > 0.5 || Object.values(p.engines).some((v) => v > 0.05)).map((p) => {
    const n = names.get(p.pid) || {};
    const eng = Object.values(p.engines);
    return { pid: p.pid, gpu: "win", type: Object.entries(p.engines).filter(([, v]) => v > 0.05).map(([k]) => k).join(", ") || "gráfico", engines: p.engines,
      gpuPct: eng.length ? Math.min(100, Math.max(...eng)) : null, vramMb: Math.round(p.vramMb) || null,
      name: n.ProcessName || String(p.pid), exe: n.Path || "", cmd: n.MainWindowTitle || "", own: true };
  });
  const gpus = (d.gpus || []).map((g, i) => ({ id: "win", index: i, vendor: "", name: g.Name, vramTotalMb: g.AdapterRAM ? Math.round(g.AdapterRAM / 1048576) : null }));
  return { gpus, procs };
}

// ---------------------------------------------------------------- tudo junto
async function snapshot() {
  if (IS_WIN) {
    const [w, nv] = await Promise.all([windowsProcs(), nvidiaGpus()]);
    return { source: "Contadores de GPU do Windows", gpus: nv || w.gpus, procs: w.procs.sort((a, b) => (b.vramMb || 0) - (a.vramMb || 0)), at: Date.now() };
  }
  const [nvG, nvP] = await Promise.all([nvidiaGpus(), nvidiaProcs()]);
  const fdP = fdinfoProcs();
  const cards = drmCards();
  const gpus = [...(nvG || [])];
  for (const [pci, c] of Object.entries(cards)) {
    if (c.vendor === "nvidia" && nvG) continue;
    gpus.push({ id: `pci:${pci}`, vendor: c.vendor, name: { amd: "GPU AMD", intel: "GPU Intel", nvidia: "GPU NVIDIA" }[c.vendor] || "GPU", load: c.busy,
      vramUsedMb: c.used != null ? Math.round(c.used / 1048576) : null, vramTotalMb: c.total != null ? Math.round(c.total / 1048576) : null });
  }
  const procs = [...nvP, ...fdP.filter((p) => !nvP.some((n) => n.pid === p.pid && /nvidia/.test(p.gpu)))]
    .map((p) => ({ ...p, ...procInfo(p.pid), name: procInfo(p.pid).name || p.name }));
  const sources = [nvG ? "nvidia-smi" : "", fdP.length ? "fdinfo do kernel" : ""].filter(Boolean);
  return { source: sources.join(" + ") || "nenhuma fonte", gpus, procs: procs.sort((a, b) => (b.vramMb || 0) - (a.vramMb || 0) || (b.gpuPct || 0) - (a.gpuPct || 0)), at: Date.now(),
    note: !nvG && !fdP.length ? "O driver desta placa não informa o uso por programa (NVIDIA: instale o driver da NVIDIA; AMD/Intel: kernel 5.19 ou mais novo)." : "" };
}

// encerrar: só processos do próprio usuário (os do sistema exigiriam administrador)
function kill(pid, force) {
  pid = Number(pid);
  if (!pid || pid === process.pid) throw new Error("Processo inválido");
  if (IS_WIN) return run("taskkill", ["/PID", String(pid), ...(force ? ["/F"] : [])]).then((o) => { if (o === null) throw new Error("Não foi possível encerrar"); return true; });
  const info = procInfo(pid);
  if (info.session) throw new Error("Esse processo é a própria sessão gráfica; encerrar derrubaria tudo.");
  if (!info.own) throw new Error("Esse processo é do sistema ou de outro usuário; ele não pode ser encerrado daqui.");
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  return true;
}

module.exports = { snapshot, kill };
