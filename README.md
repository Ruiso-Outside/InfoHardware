# InfoHardware

App para Windows com informações completas do hardware e monitoramento em tempo real (com overlay para jogos), interface escura com neon roxo.

## Instalar
Execute `dist\InfoHardware-Setup-1.0.0.exe`. O app é instalado em `%LocalAppData%\Programs\InfoHardware`, ganha atalhos na Área de Trabalho e no Menu Iniciar e aparece em **Configurações › Aplicativos** (onde também pode ser desinstalado).
Não precisa instalar o .NET — o runtime vai junto. Ao abrir, o app pede permissão de administrador (necessária para ler os sensores e medir FPS).

Modo silencioso: `InfoHardware-Setup-1.0.0.exe /silent [/dir=C:\pasta] [/noshortcuts] [/run]`

## Telas
- **Painel** — medidores de CPU, GPU, RAM e VRAM, FPS ao vivo, gráficos de uso/temperatura, carga por núcleo, disco e rede.
- **Hardware** — sistema, processador, placa-mãe/BIOS, memória (por pente), placas de vídeo, monitores, armazenamento, rede, áudio e bateria. Exporta relatório `.txt`.
- **Sensores** — todos os sensores (temperaturas, tensões, clocks, ventoinhas, consumo…) com mínimo/máximo e filtro.
- **Desempenho** — gráficos dos últimos 2 minutos e **gravação de sessão** em CSV com resumo mín/méd/máx (`Ctrl+Shift+R`).
- **Overlay de jogo** — FPS, frametime, 1% low, CPU, GPU, VRAM e RAM por cima do jogo (`Ctrl+Shift+O`).

## Observações
- Temperatura/consumo da CPU, ventoinhas e tensões da placa-mãe dependem do driver **PawnIO** (o app oferece instalar via `winget`).
- O FPS é medido via ETW em jogos DirectX 9/10/11/12. O overlay aparece em jogos no modo *janela sem bordas*; em tela cheia exclusiva o Windows pode escondê-lo.

## Compilar
Requer .NET SDK 9:
```
powershell -ExecutionPolicy Bypass -File build.ps1
```
Diagnóstico de sensores: `InfoHardware.exe --report relatorio.txt`

## Módulo do Piphin Hub
O InfoHardware também roda **dentro do [Piphin Hub](https://github.com/Ruiso-Outside/Piphin-Hub)** (1.3.0 ou mais novo), como módulo de cerca de 4,5 MB, com as mesmas telas (Painel, Hardware, Sensores, Desempenho, Overlay) e o overlay de jogo.

- **Motor de sensores** (`src/InfoHardware.Engine`): biblioteca .NET Framework 4.7.2 que reaproveita os serviços do app (`HardwareMonitor`, `FpsMonitor`, `SystemInfoService`) e roda **dentro do PowerShell do Windows** (`start.ps1`). Assim não há `.exe` próprio para o Controle Inteligente de Aplicativos bloquear. Ele conversa com o módulo por uma conexão local (127.0.0.1) protegida por um código e se encerra junto com o módulo.
- **Administrador**: o motor é aberto com o pedido do Windows (UAC) para ler temperatura da CPU, discos e FPS. Se o pedido for recusado, roda em modo limitado (GPU, uso, RAM, rede) e a tela oferece "Ativar modo completo".
- O motor só fica ligado enquanto alguém usa: a tela do módulo aberta, o overlay ou uma gravação (desliga 30 s depois).
- **Interface** (`module/`): `backend.js` (o papel do app no Hub), `web/` (telas e overlay).
- As sessões gravadas ficam em `Documentos\InfoHardware\Sessoes`, como no app.

Gerar o módulo (requer .NET SDK 9):
```
powershell -ExecutionPolicy Bypass -File build-module.ps1
```
Sai em `dist\piphin-module-infohardware-<versão>.zip`; publique-o no Release junto com o instalador.

### Overlay de jogo (no módulo do Hub)
Aba **Overlay**:
- Três estilos: **Painel** (com gráfico do FPS dos últimos 60 s), **Linha** (discreto, numa linha só) e **Só FPS**.
- Três temas: Neon, Escuro e Transparente.
- Cores de alerta: FPS baixo e temperatura alta mudam de cor, e a temperatura alta pisca.
- O nome do jogo e o tempo de partida aparecem no topo.

**Ligar sozinho quando um jogo abrir**: o [Piphin Jogos](https://github.com/Ruiso-Outside/Piphin-Jogos) avisa quando um jogo de qualquer loja abre, e o overlay aparece e some sozinho. O `Ctrl+Shift+O` esconde o overlay só naquele jogo. Nesse modo o motor de sensores fica ligado em segundo plano.

**Desempenho por jogo**: com o motor ligado durante a partida, o InfoHardware guarda, para cada jogo do Piphin Jogos (`desempenho-jogos.json`, até 30 partidas por jogo):
- FPS médio, mínimo e 1% low;
- temperaturas máximas da CPU e da GPU;
- uso da CPU e da GPU;
- o que segurou o FPS: placa de vídeo no limite, processador, ou FPS travado por V-Sync ou por um limite.

O Piphin Jogos mostra isso na página do jogo, e a IA lê pela ferramenta `game_performance`.

Os dois módulos conversam pelo servidor de ferramentas do Hub (1.5.0 ou mais novo):
- o InfoHardware pergunta `jogos_now_playing` a cada 5 s;
- o Jogos pede `infohardware_game_performance`.

Código: `module/perf.js` (o desempenho por partida), `web/overlay-render.js` e `web/overlay.css` (o desenho, usado pelo overlay e pela prévia).

### Benchmark (no módulo do Hub)
Aba **Benchmark**: um teste de ~15 s mede o processador (um núcleo e todos os núcleos) e a memória e dá uma nota fácil de entender.
- **1000 pontos = um PC médio para jogos** (Ryzen 5 5600 / Core i5-12400 com DDR4-3200). As referências ficam em `module/bench.js` (`REF`) e são aproximadas.
- Nível em estrelas, "para o que ele serve" (jogos, edição de vídeo, IA...) e **o que dá para melhorar**, com base no PC: memória abaixo do padrão (EXPO/XMP desligado), um pente só, pouca RAM, Windows num HD, disco cheio, modo Economia de energia, processador quente ou perdendo velocidade no teste, muitos programas na inicialização, driver de vídeo antigo.
- O motor faz o teste (`src/InfoHardware.Engine/Bench.cs`) e coleta os dados do PC; a nota e as dicas são calculadas no módulo. O histórico fica em `bench-history.json` na pasta de dados do módulo.

### PawnIO
O instalador do PawnIO recusa instalar por cima de uma instalação existente (erro 183). O botão **Reparar PawnIO** abre `module/pawnio-fix.ps1` como administrador: remove a instalação antiga pelo próprio desinstalador, instala de novo pelo winget e confere se o driver (`\.\PawnIO`) carregou.
