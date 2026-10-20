// Nota do teste de desempenho e dicas de melhoria, em linguagem simples.
// 1000 pontos = um PC médio para jogos (Ryzen 5 5600 / Core i5-12400 com DDR4-3200 em dois pentes).
// As referências são aproximadas: servem para comparar, não são uma medida de laboratório.
const REF = { single: 42500, multi: 455000, memory: 40 };

const TIERS = [
  { min: 1900, stars: 5, name: "Topo de linha", text: "Seu processador está entre os mais rápidos para PC. Dá conta de qualquer coisa: jogos pesados, edição de vídeo 4K, IA local e muitos programas ao mesmo tempo." },
  { min: 1300, stars: 4, name: "Excelente", text: "Bem acima de um PC médio. Joga e trabalha com folga, inclusive com programas pesados." },
  { min: 850, stars: 3, name: "Muito bom", text: "No nível de um bom PC para jogos atual. Roda bem jogos e programas do dia a dia; tarefas muito pesadas levam um pouco mais de tempo." },
  { min: 500, stars: 2, name: "Bom para o dia a dia", text: "Tranquilo para internet, estudos, escritório e jogos leves. Jogos pesados e edição de vídeo podem ficar lentos." },
  { min: 0, stars: 1, name: "Básico", text: "Dá para navegar e usar programas simples, mas ele sofre com jogos e tarefas pesadas." },
];

const USES = [
  { id: "office", icon: "file-text", name: "Internet, estudos e escritório", ok: (s) => s.overall >= 250 },
  { id: "games", icon: "gamepad-2", name: "Jogos em Full HD", ok: (s) => s.single >= 750 && s.multi >= 500 },
  { id: "fps", icon: "zap", name: "Jogos competitivos com FPS alto", ok: (s) => s.single >= 1150 && s.multi >= 800 },
  { id: "stream", icon: "radio", name: "Jogar e transmitir ao mesmo tempo", ok: (s) => s.multi >= 1100 },
  { id: "video", icon: "video", name: "Edição de vídeo e 3D", ok: (s) => s.multi >= 1500 },
  { id: "ai", icon: "brain", name: "IA local e programação pesada", ok: (s) => s.multi >= 1300 && s.memory >= 900 },
];

function score(r) {
  const single = Math.round((r.single / REF.single) * 1000);
  const multi = Math.round((r.multi / REF.multi) * 1000);
  const memory = Math.round((r.memoryGBs / REF.memory) * 1000);
  // média geométrica com pesos: um ponto muito forte não esconde um ponto fraco
  const overall = Math.round(Math.exp(0.45 * Math.log(Math.max(1, single)) + 0.4 * Math.log(Math.max(1, multi)) + 0.15 * Math.log(Math.max(1, memory))));
  const tier = TIERS.find((t) => overall >= t.min);
  const s = { single, multi, memory, overall };
  return { ...s, tier: { stars: tier.stars, name: tier.name, text: tier.text },
    uses: USES.map((u) => ({ id: u.id, icon: u.icon, name: u.name, ok: u.ok(s) })) };
}

// ------------------------------------------------------------------ dicas
// impact: "alto" | "médio" | "baixo"; action: botão que o módulo sabe executar
function tips({ facts = {}, telemetry = {}, powerPlan = null, engine = {} }) {
  const out = [];
  const mem = facts.memory || [];
  const totalGB = mem.reduce((n, m) => n + (m.gb || 0), 0);
  const ram = mem[0] || {};
  const configured = ram.configured || ram.speed || 0;

  // memória mais lenta do que o padrão do tipo (EXPO/XMP desligado ou ajuste conservador da BIOS)
  const base = ram.type === "DDR5" ? 4800 : ram.type === "DDR4" ? 2666 : 0;
  const rated = Math.max(...mem.map((m) => m.speed || 0), 0);
  if (base && configured && (configured < base || (rated > configured))) {
    out.push({ impact: "alto", icon: "memory-stick", title: "A memória RAM está rodando mais devagar do que pode",
      text: `Ela está a ${configured} MT/s, e memórias ${ram.type} costumam rodar a ${ram.type === "DDR5" ? "4800 MT/s ou mais (6000 MT/s nos kits para jogos)" : "3200 MT/s ou mais"}. Memória lenta derruba o FPS em jogos e deixa o PC todo mais lento.`,
      how: "Entre na BIOS (aperte Delete ao ligar o PC) e ative o perfil EXPO (placas AMD) ou XMP (placas Intel) da memória. Salve e reinicie. Se o PC não ligar, a BIOS volta sozinha ao padrão." });
  }
  if (mem.length === 1) out.push({ impact: "alto", icon: "memory-stick", title: "Só um pente de memória",
    text: "Com um pente só, a memória trabalha pela metade (single channel). Dois pentes iguais podem dar bem mais FPS em jogos.",
    how: "Compre um segundo pente igual ao seu e encaixe no slot indicado no manual da placa-mãe (geralmente o 2º e o 4º)." });
  if (totalGB && totalGB < 16) out.push({ impact: totalGB < 8 ? "alto" : "médio", icon: "memory-stick", title: `Pouca memória RAM (${Math.round(totalGB)} GB)`,
    text: "Jogos e navegadores atuais usam bastante memória. Com menos de 16 GB o Windows passa a usar o disco no lugar da RAM, e tudo fica lento.",
    how: "Para jogos e uso geral, 16 GB é o mínimo confortável; 32 GB dá folga." });

  const disk = facts.systemDisk || {};
  if (disk.media === "HDD") out.push({ impact: "alto", icon: "hard-drive", title: "O Windows está num HD (disco mecânico)",
    text: "É a melhoria mais perceptível que existe: com um SSD o PC liga em segundos, os programas abrem na hora e os jogos carregam muito mais rápido.",
    how: "Troque por um SSD (de preferência NVMe, se a placa-mãe tiver encaixe M.2) e reinstale ou clone o Windows nele." });
  const drv = facts.systemDrive;
  if (drv && drv.totalGB && (drv.freeGB / drv.totalGB < 0.12 || drv.freeGB < 20)) out.push({ impact: "médio", icon: "hard-drive", title: `Pouco espaço livre no disco ${drv.letter} (${Math.round(drv.freeGB)} GB)`,
    text: "Com o disco do Windows quase cheio, atualizações falham e o sistema fica mais lento.",
    how: "Apague arquivos grandes que não usa, desinstale jogos parados e use a Limpeza de Disco do Windows.", action: { id: "cleanmgr", label: "Abrir Limpeza de Disco" } });

  if (powerPlan && powerPlan.saver) out.push({ impact: "alto", icon: "power", title: "O Windows está no modo Economia de energia",
    text: "Nesse modo o processador é segurado de propósito para gastar menos energia, e o PC rende menos.",
    how: "Troque para o plano Equilibrado (recomendado) com o botão abaixo.", action: { id: "power-balanced", label: "Mudar para Equilibrado" } });

  if (telemetry.maxTemp != null && telemetry.maxTemp >= 90) out.push({ impact: "alto", icon: "thermometer", title: `O processador esquentou demais (${Math.round(telemetry.maxTemp)} °C no teste)`,
    text: "Acima de 90 °C o processador reduz a velocidade para se proteger, e o PC perde desempenho em jogos e tarefas longas.",
    how: "Limpe a poeira do cooler e do gabinete, confira se as ventoinhas giram e, se o PC tiver mais de 3 anos, troque a pasta térmica. Um cooler melhor também ajuda." });
  else if (telemetry.throttle != null && telemetry.throttle >= 0.12) out.push({ impact: "médio", icon: "flame", title: `O processador perdeu velocidade durante o teste (-${Math.round(telemetry.throttle * 100)}%)`,
    text: "Sob carga pesada o clock caiu, o que normalmente indica calor ou limite de energia.",
    how: "Melhore a ventilação do gabinete e limpe o cooler. Em notebooks, use na tomada e numa superfície dura." });
  if (telemetry.maxTemp == null && engine.pawnIoState && engine.pawnIoState !== "ok") out.push({ impact: "baixo", icon: "info", title: "Não deu para medir a temperatura do processador",
    text: "Sem o driver PawnIO funcionando, o InfoHardware não consegue ver se o processador está esquentando demais durante o teste.",
    how: "Use o botão \"Reparar PawnIO\" no topo da tela e rode o teste de novo.", action: { id: "pawnio", label: "Reparar PawnIO" } });

  if ((facts.startupApps || 0) > 12) out.push({ impact: "baixo", icon: "rocket", title: `${facts.startupApps} programas abrem junto com o Windows`,
    text: "Cada um deles atrasa a inicialização e fica gastando memória o tempo todo.",
    how: "No Gerenciador de Tarefas, aba Aplicativos de inicialização, desative o que você não usa sempre.", action: { id: "startup", label: "Abrir aplicativos de inicialização" } });

  const now = Date.now();
  for (const g of facts.gpus || []) {
    if (!g.driverDate || /Microsoft Basic|Remote/i.test(g.name)) continue;
    const ageDays = (now - Date.parse(g.driverDate)) / 86400000;
    if (ageDays > 365) out.push({ impact: "médio", icon: "monitor", title: `Driver de vídeo antigo (${g.name})`,
      text: `O driver é de ${new Date(g.driverDate).toLocaleDateString("pt-BR")}. Drivers novos corrigem problemas e costumam dar mais FPS nos jogos recentes.`,
      how: /nvidia/i.test(g.name) ? "Atualize pelo aplicativo NVIDIA App (ou em nvidia.com/drivers)." : /amd|radeon/i.test(g.name) ? "Atualize pelo AMD Software: Adrenalin Edition (ou em amd.com/support)." : "Atualize pelo site do fabricante da placa de vídeo." });
  }
  const order = { alto: 0, "médio": 1, baixo: 2 };
  return out.sort((a, b) => order[a.impact] - order[b.impact]);
}

module.exports = { score, tips, REF };
