// Overlay de jogo: recebe as leituras do módulo, o jogo aberto (Piphin Jogos) e se ajusta ao tamanho do conteúdo.
const box = document.getElementById("box");
let cfg = { scale: 1, style: "panel", theme: "neon", graph: true, colors: true, show: { game: true, fps: true, frameTime: true, cpu: true, gpu: true, ram: true, vram: true, power: true } };
let last = null, game = null, lastW = 0, lastH = 0;
const hist = []; // FPS dos últimos 60 s, para o gráfico

function render() {
  box.innerHTML = OverlayRender.html(last, cfg, game, hist);
  box.style.transform = `scale(${cfg.scale || 1})`;
  // a janela acompanha o tamanho do conteúdo
  const r = box.getBoundingClientRect();
  const w = Math.ceil(r.width) + 2, h = Math.ceil(r.height) + 2;
  if (Math.abs(w - lastW) > 3 || Math.abs(h - lastH) > 3) { lastW = w; lastH = h; piphin.invoke("overlay-size", w, h); }
}

piphin.on("config", (c) => { cfg = c; render(); });
piphin.on("game", (g) => { const changed = (g && g.game_id) !== (game && game.game_id); game = g; if (changed) hist.length = 0; render(); });
piphin.on("snap", (s) => {
  last = s;
  const f = s.fps && s.fps.fps;
  hist.push(typeof f === "number" && isFinite(f) ? f : NaN);
  if (hist.length > 60) hist.shift();
  render();
});
piphin.invoke("overlay-ready").then((r) => { const d = r && r.ok ? r.data : null; if (!d) return; cfg = d.config || cfg; game = d.game; last = d.snap || last; render(); }).catch(() => {});
// o relógio da partida anda mesmo sem leituras novas
setInterval(() => { if (game) render(); }, 30000);
