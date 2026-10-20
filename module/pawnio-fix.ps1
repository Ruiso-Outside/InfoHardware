# Instala ou repara o driver PawnIO (temperatura e consumo da CPU). Aberto pelo InfoHardware, como administrador.
# O instalador do PawnIO recusa instalar por cima de uma instalação existente (erro 183, "já existe"), então:
#   1) tenta o desinstalador do PawnIO (com limite de tempo: ele pode travar quando o driver nem chegou a carregar);
#   2) se não deu certo, remove à mão o registro e a pasta que fazem o instalador achar que já está instalado;
#   3) instala pelo winget e confere se o driver carregou.
# Tudo fica registrado em %TEMP%\piphin-pawnio-fix.log.
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'piphin-pawnio-fix.log'
Start-Transcript -Path $log -Force | Out-Null
try { $Host.UI.RawUI.WindowTitle = 'PawnIO · InfoHardware' } catch { }
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PawnDev {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static bool Loaded() { var h = CreateFile(@"\\.\PawnIO", 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero); if (h == new IntPtr(-1)) return false; CloseHandle(h); return true; }
}
'@

$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO'
$dir = Join-Path $env:ProgramFiles 'PawnIO'
Say 'Driver PawnIO · temperatura e consumo da CPU' Magenta
Say "Registro detalhado: $log" DarkGray

# ---------------------------------------------------------------- 1) desinstalar o que existe
if ((Test-Path $key) -or (Test-Path $dir)) {
  Say "`n[1/3] Removendo a instalação anterior do PawnIO..." Cyan
  $un = Join-Path $dir 'uninstall.exe'
  if (Test-Path $un) {
    $p = Start-Process $un -ArgumentList '-uninstall', '-silent' -PassThru
    if ($p.WaitForExit(60000)) { Say "      desinstalador terminou (código $($p.ExitCode))" }
    else { Say '      o desinstalador travou; encerrando ele' Yellow; try { $p.Kill() } catch { } }
    Start-Sleep -Seconds 2
  }
  # o que sobrou faz o instalador responder "já existe" (183): sai à mão
  $svc = Get-Service PawnIO -ErrorAction SilentlyContinue
  if ($svc) { Say '      parando e removendo o serviço PawnIO'; Stop-Service PawnIO -Force -ErrorAction SilentlyContinue; sc.exe delete PawnIO | Out-Null }
  if (Test-Path $key) { Say '      removendo o registro de instalação'; Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $dir) { Say "      removendo a pasta $dir"; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
  if ((Test-Path $key) -or (Test-Path $dir)) { Say '      não foi possível remover tudo (reinicie o PC e tente de novo)' Yellow } else { Say '      instalação anterior removida' Green }
} else {
  Say "`n[1/3] Nenhuma instalação anterior encontrada." Cyan
}

# ---------------------------------------------------------------- 2) instalar
Say "`n[2/3] Instalando o PawnIO (winget)..." Cyan
$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Say '      winget não encontrado. Instale o "Instalador de Aplicativo" pela Microsoft Store e tente de novo.' Yellow
  $code = -1
} else {
  & $winget.Source install --id namazso.PawnIO -e --force --accept-package-agreements --accept-source-agreements
  $code = $LASTEXITCODE
  Say "      winget terminou (código $code)"
}

# ---------------------------------------------------------------- 3) conferir
Say "`n[3/3] Conferindo o driver..." Cyan
Start-Sleep -Seconds 2
if ([PawnDev]::Loaded()) {
  Say "`nPronto! O driver PawnIO está funcionando." Green
  Say "Volte ao InfoHardware e clique em 'Reiniciar o motor' (Ajustes) para ver a temperatura e o consumo da CPU."
} else {
  Say "`nO driver ainda não carregou." Yellow
  $blocked = Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 300 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'pawn' } | Select-Object -First 1
  if ($blocked) {
    Say 'O Windows bloqueou o driver:' Yellow
    Say ('  ' + $blocked.Message.Split("`n")[0])
    Say 'Isso vem das proteções do Windows (Integridade de memória / lista de drivers bloqueados).'
  } elseif ($code -ne 0) {
    Say "A instalação falhou (código $code). Mande o arquivo $log para análise."
  } else {
    Say 'Reinicie o computador e abra o InfoHardware de novo: alguns drivers só carregam depois de reiniciar.'
  }
}
Stop-Transcript | Out-Null
Read-Host "`nAperte Enter para fechar"
