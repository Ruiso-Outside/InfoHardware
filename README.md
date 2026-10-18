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
