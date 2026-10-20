// Tela "Benchmark" do InfoHardware (teste de desempenho para leigos). Usa $, esc, fmt, mhz, PT, isNum, S e call do app.js.
let B = { running: false, phase: "", pct: 0, last: null, history: [] };
const PHASES = [
  ["single", "Um núcleo", "A velocidade de cada núcleo: o que mais pesa no dia a dia e na maioria dos jogos", 0, 0.35],
  ["multi", "Todos os núcleos", "Trabalho pesado: edição de vídeo, compactar arquivos, IA local, jogar e transmitir", 0.35, 0.45],
  ["memory", "Memória", "Quão rápido os dados vão e voltam da memória RAM", 0.8, 0.2],
];
const benchPct = () => { const p = PHASES.find((x) => x[0] === B.phase); return p ? p[3] + p[4] * (B.pct || 0) : 0; };
const stars = (n) => '<span class="stars">' + [1, 2, 3, 4, 5].map((i) => '<i class="i i-star ' + (i <= n ? "on" : "") + '"></i>').join("") + "</span>";
const IMPACT = { alto: ["err", "Muita diferença"], "médio": ["warn", "Diferença média"], baixo: ["info", "Pouca diferença"] };

function renderBench() {
  if (B.running) return renderBenchRunning();
  const r = B.last;
  if (!r) {
    $("#content").innerHTML = `<div><div class="bench-hero card">
      <div class="bench-ico"><i class="i i-rocket"></i></div>
      <h1>Quão rápido é o seu PC?</h1>
      <p>Um teste de cerca de 15 segundos mede o processador e a memória e compara com um <b>PC médio para jogos</b>. No fim você vê uma nota fácil de entender e o que dá para melhorar.</p>
      <button class="btn primary lg" data-act="benchstart"><i class="i i-play"></i>Iniciar teste</button>
      <span class="faint" style="font-size:12.5px">Antes, feche jogos e programas pesados para o resultado ser justo.</span></div>
      ${B.history.length ? benchHistory() : ""}</div>`;
    return;
  }
  const prev = B.history[1];
  const delta = prev ? Math.round((r.overall / prev.overall - 1) * 100) : null;
  const times = (r.overall / 1000).toLocaleString(PT, { maximumFractionDigits: 1 });
  const bar = (key, label, desc, icon) => {
    const v = r[key], max = Math.max(2500, v * 1.1);
    return `<div class="b-bar"><div class="row" style="justify-content:space-between"><span class="row" style="gap:8px"><i class="i i-${icon}"></i><b>${label}</b></span><b class="num">${fmt(v)}</b></div>
      <div class="b-track"><i style="width:${Math.min(100, (v / max) * 100)}%"></i><span class="b-ref" style="left:${(1000 / max) * 100}%" title="PC médio para jogos = 1000"></span></div>
      <div class="faint" style="font-size:12px">${desc}</div></div>`;
  };
  const tipCard = (t) => `<div class="card tip">
      <div class="row" style="justify-content:space-between;align-items:flex-start"><div class="row" style="gap:12px;align-items:flex-start">
        <span class="tip-ico ${IMPACT[t.impact][0]}"><i class="i i-${t.icon}"></i></span><div><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p></div></div>
        <span class="badge ${IMPACT[t.impact][0]}">${IMPACT[t.impact][1]}</span></div>
      <div class="how"><b>Como fazer:</b> ${esc(t.how)}</div>
      ${t.action ? `<button class="btn sm" data-benchact="${esc(t.action.id)}"><i class="i i-arrow-right"></i>${esc(t.action.label)}</button>` : ""}</div>`;
  $("#content").innerHTML = `<div>
    <div class="bench-result">
      <div class="card score-card">
        <div class="score-num" id="scoreNum">${fmt(r.overall)}</div>
        <div class="score-lbl">pontos</div>
        ${stars(r.tier.stars)}
        <div class="score-tier">${esc(r.tier.name)}</div>
        <p>${esc(r.tier.text)}</p>
        <div class="score-cmp"><i class="i i-gauge"></i>${r.overall >= 1000 ? `${times}× um PC médio para jogos` : `${Math.round(r.overall / 10)}% de um PC médio para jogos`}</div>
        ${delta != null && delta !== 0 ? `<div class="badge ${delta > 0 ? "ok" : "warn"}" style="margin-top:10px">${delta > 0 ? "+" : ""}${delta}% desde o último teste</div>` : ""}
        <div class="row" style="margin-top:16px;justify-content:center"><button class="btn" data-act="benchstart"><i class="i i-rotate-ccw"></i>Testar de novo</button></div>
      </div>
      <div class="stack" style="gap:14px">
        <div class="card"><div class="card-title"><span><i class="i i-chart-no-axes-column"></i> Resultado de cada parte</span><span class="faint">linha = PC médio (1000)</span></div>
          ${bar("single", "Um núcleo", "Dia a dia e a maioria dos jogos", "cpu")}
          ${bar("multi", "Todos os núcleos", "Edição de vídeo, compactar arquivos, IA, jogar e transmitir", "layers")}
          ${bar("memory", "Memória", "Velocidade da memória RAM", "memory-stick")}</div>
        <div class="card"><div class="card-title"><span><i class="i i-sparkles"></i> Para o que ele serve</span></div>
          <div class="uses">${r.uses.map((u) => `<div class="use ${u.ok ? "ok" : "no"}"><i class="i i-${u.icon}"></i><span>${esc(u.name)}</span>
            <span class="badge ${u.ok ? "ok" : "warn"}">${u.ok ? '<i class="i i-check"></i>vai bem' : "pode ficar lento"}</span></div>`).join("")}</div></div>
      </div>
    </div>
    <div class="p-section">O que dá para melhorar</div>
    ${r.tips.length ? `<div class="tips">${r.tips.map(tipCard).join("")}</div>`
      : `<div class="card row" style="gap:14px"><i class="i i-circle-check" style="font-size:26px;color:var(--p-ok)"></i><div><b>Nada importante para melhorar</b>
         <div class="muted" style="font-size:13px">Memória, disco, energia e temperatura estão em ordem. Seu PC está entregando o que pode.</div></div></div>`}
    <div class="row faint bench-foot"><i class="i i-info"></i><span>${r.telemetry && r.telemetry.maxTemp != null ? `Temperatura máxima do processador no teste: <b>${fmt(r.telemetry.maxTemp)} °C</b>. ` : ""}
      Notas aproximadas, comparadas a um PC médio para jogos (Ryzen 5 5600 / Core i5-12400 com DDR4-3200 = 1000). O teste mede o processador e a memória; a placa de vídeo não entra.</span></div>
    ${B.history.length > 1 ? benchHistory() : ""}
  </div>`;
  countUp();
}

function renderBenchRunning() {
  const pct = benchPct();
  const CIRC = 2 * Math.PI * 70;
  const t = S.snap && S.snap.hw;
  const cur = PHASES.findIndex((p) => p[0] === B.phase);
  $("#content").innerHTML = `<div><div class="bench-hero card running">
    <div class="ring"><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" class="bg"/><circle cx="80" cy="80" r="70" class="fg" stroke-dasharray="${CIRC * pct} ${CIRC}"/></svg>
      <div class="ring-val">${Math.round(pct * 100)}<small>%</small></div></div>
    <h1>Testando o seu PC...</h1>
    <p>Não use o computador até terminar. O processador vai trabalhar no máximo por alguns segundos: é normal as ventoinhas acelerarem.</p>
    <div class="steps">${PHASES.map(([id, name, desc], k) => {
      const st = cur < 0 ? "wait" : k < cur ? "done" : k === cur ? "now" : "wait";
      return `<div class="step ${st}"><span class="dot-st">${st === "done" ? '<i class="i i-check"></i>' : st === "now" ? '<span class="spin" style="width:14px;height:14px"></span>' : k + 1}</span>
        <div><b>${name}</b><div class="faint" style="font-size:12px">${desc}</div></div></div>`; }).join("")}</div>
    <div class="row faint" style="gap:18px;font-size:12.5px"><span><i class="i i-cpu"></i> ${t && isNum(t.cpuLoad) ? fmt(t.cpuLoad) + "%" : "--"} de uso</span>
      <span><i class="i i-zap"></i> ${t ? mhz(t.cpuClock) : "--"}</span><span><i class="i i-thermometer"></i> ${t && isNum(t.cpuTemp) ? fmt(t.cpuTemp) + " °C" : "--"}</span></div>
    <button class="btn ghost" data-act="benchcancel"><i class="i i-x"></i>Cancelar</button></div></div>`;
}

function benchHistory() {
  return `<div class="p-section">Testes anteriores</div><div class="card"><table class="table"><thead><tr><th>Quando</th><th>Nível</th><th class="num">Um núcleo</th><th class="num">Todos</th><th class="num">Memória</th><th class="num">Nota</th></tr></thead><tbody>
    ${B.history.slice(0, 8).map((h) => `<tr><td>${new Date(h.at).toLocaleString(PT, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(h.tier)}</td>
      <td class="num">${fmt(h.single)}</td><td class="num">${fmt(h.multi)}</td><td class="num">${fmt(h.memory)}</td><td class="num"><b>${fmt(h.overall)}</b></td></tr>`).join("")}</tbody></table></div>`;
}

// a nota "sobe" até o valor final
function countUp() {
  const el = $("#scoreNum");
  if (!el || !B.last || B.animated === B.last.at) return;
  B.animated = B.last.at;
  const end = B.last.overall, t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / 900); el.textContent = fmt(Math.round(end * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

