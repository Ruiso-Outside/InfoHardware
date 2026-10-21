// InfoHardware · desempenho de cada partida: enquanto um jogo (avisado pelo Piphin Jogos) está aberto e o motor está
// ligado, junta FPS, 1% low, temperaturas e uso a cada leitura; quando o jogo fecha, guarda um resumo por jogo.
const fs = require("fs");

const MAX_SESSIONS = 30;
const CAPS = [30, 60, 75, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 360];
const isNum = (v) => typeof v === "number" && isFinite(v);
const r1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);

function createPerf(file) {
  let db = { games: {} };
  try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* primeira vez */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(db)); } catch { /* sem disco */ } };
  let cur = null;

  const acc = () => ({ n: 0, sum: 0, sq: 0, min: Infinity, max: -Infinity });
  const add = (a, v) => { if (!isNum(v)) return; a.n++; a.sum += v; a.sq += v * v; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); };
  const avg = (a) => (a.n ? a.sum / a.n : null);

  // uma leitura do motor + o que o Piphin Jogos diz que está aberto
  function feed(snap, playing) {
    const fps = snap && snap.fps, proc = String((fps && fps.process) || "").toLowerCase();
    // o jogo cujo .exe é o que está desenhando os quadros; se o Jogos não sabe os .exe, vale o único jogo aberto
    let g = playing.find((p) => (p.exes || []).includes(proc)) || (playing.length === 1 && !(playing[0].exes || []).length ? playing[0] : null);
    if (cur && !playing.some((p) => p.game_id === cur.id)) finish();
    if (!g) return;
    if (!cur || cur.id !== g.game_id) { finish(); cur = { id: g.game_id, name: g.name, start: Date.now(), fps: acc(), low1: acc(), cpuT: acc(), gpuT: acc(), cpuL: acc(), gpuL: acc(), gpuW: acc() }; }
    const h = (snap && snap.hw) || {};
    // telas de carregamento (FPS muito baixo ou travado) não contam
    if (fps && isNum(fps.fps) && fps.fps >= 5) { add(cur.fps, fps.fps); add(cur.low1, fps.low1); }
    add(cur.cpuT, h.cpuTemp); add(cur.gpuT, h.gpuTemp); add(cur.cpuL, h.cpuLoad); add(cur.gpuL, h.gpuLoad); add(cur.gpuW, h.gpuPower);
  }

  // o que segurou o FPS nesta partida
  function limitOf(s) {
    if (!isNum(s.fps_avg)) return null;
    const cap = CAPS.find((c) => Math.abs(s.fps_avg - c) / c < 0.03);
    if (cap && s.fps_sd != null && s.fps_sd < cap * 0.04) return { kind: "cap", cap };
    if (isNum(s.gpu_load_avg) && s.gpu_load_avg >= 92) return { kind: "gpu" };
    if (isNum(s.gpu_load_avg) && s.gpu_load_avg < 75) return { kind: "cpu" };
    return null;
  }
  function finish() {
    const c = cur; cur = null;
    if (!c || c.fps.n < 30) return null; // menos de ~30 s de jogo de verdade: não guarda
    const fa = avg(c.fps), sd = Math.sqrt(Math.max(0, c.fps.sq / c.fps.n - fa * fa));
    const s = { start: new Date(c.start).toISOString(), minutes: Math.round((Date.now() - c.start) / 60000), fps_avg: r1(fa), fps_min: r1(c.fps.min), fps_max: r1(c.fps.max), fps_sd: r1(sd),
      low1_avg: r1(avg(c.low1)), cpu_temp_max: c.cpuT.n ? r1(c.cpuT.max) : null, gpu_temp_max: c.gpuT.n ? r1(c.gpuT.max) : null, cpu_temp_avg: r1(avg(c.cpuT)), gpu_temp_avg: r1(avg(c.gpuT)),
      cpu_load_avg: r1(avg(c.cpuL)), gpu_load_avg: r1(avg(c.gpuL)), gpu_power_avg: r1(avg(c.gpuW)) };
    s.limit = limitOf(s);
    const g = db.games[c.id] || (db.games[c.id] = { name: c.name, sessions: [] });
    g.name = c.name; g.sessions.unshift(s); g.sessions = g.sessions.slice(0, MAX_SESSIONS);
    save();
    return { id: c.id, name: c.name, ...s };
  }

  const LIMIT_TEXT = {
    gpu: "A placa de vídeo trabalhou no limite, o que é normal em jogos pesados. Para ganhar FPS, baixe a qualidade gráfica ou a resolução (ou ative DLSS/FSR, se o jogo tiver).",
    cpu: "A placa de vídeo sobrou: o processador (ou o próprio jogo) é que está segurando o FPS. Baixar a qualidade gráfica ajuda pouco; feche programas em segundo plano e confira o plano de energia.",
    cap: (c) => `O FPS ficou travado em ${c}: é o V-Sync ou um limite de FPS ligado (no jogo ou no driver). Se quiser mais FPS, desligue o limite.`,
  };
  // resumo de um jogo (por id do Piphin Jogos ou pelo nome)
  function game(id, name) {
    let g = id && db.games[id];
    if (!g && name) { const q = String(name).toLowerCase(); const k = Object.keys(db.games).find((k) => db.games[k].name.toLowerCase() === q) || Object.keys(db.games).find((k) => db.games[k].name.toLowerCase().includes(q)); g = k && db.games[k]; }
    const sessions = g ? g.sessions : [];
    const recent = sessions.slice(0, 5), mean = (k) => { const v = recent.map((s) => s[k]).filter(isNum); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const kinds = recent.map((s) => s.limit && s.limit.kind).filter(Boolean);
    const top = ["cap", "gpu", "cpu"].map((k) => [k, kinds.filter((x) => x === k).length]).sort((a, b) => b[1] - a[1])[0];
    const limit = top && top[1] * 2 > recent.length ? (top[0] === "cap" ? LIMIT_TEXT.cap(recent.find((s) => s.limit && s.limit.kind === "cap").limit.cap) : LIMIT_TEXT[top[0]]) : null;
    return { game: g ? g.name : name || id, summary: { sessions: sessions.length, fps_avg: mean("fps_avg"), low1_avg: mean("low1_avg"),
      cpu_temp_max: recent.length ? Math.max(0, ...recent.map((s) => s.cpu_temp_max || 0)) || null : null, gpu_temp_max: recent.length ? Math.max(0, ...recent.map((s) => s.gpu_temp_max || 0)) || null : null,
      limit, based_on: recent.length === 1 ? "última partida" : `últimas ${recent.length} partidas` }, sessions };
  }
  const all = () => Object.entries(db.games).map(([id, g]) => ({ game_id: id, name: g.name, sessions: g.sessions.length, last: g.sessions[0] && g.sessions[0].start, fps_avg: game(id).summary.fps_avg }));
  return { feed, finish, game, all, current: () => cur && { id: cur.id, name: cur.name, start: cur.start } };
}

module.exports = { createPerf };
