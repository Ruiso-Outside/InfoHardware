# Instala ou repara o driver PawnIO (temperatura e consumo da CPU). Aberto pelo InfoHardware, como administrador.
# O instalador do PawnIO recusa instalar por cima de uma instalação existente (erro 183, "já existe"),
# então a instalação antiga sai primeiro, pelo próprio desinstalador dele.
$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'PawnIO · InfoHardware'
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PawnDev {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static bool Loaded() { var h = CreateFile(@"\\.\PawnIO", 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero); if (h == new IntPtr(-1)) return false; CloseHandle(h); return true; }
}
'@

Say 'Driver PawnIO · temperatura e consumo da CPU' Magenta
$un = Join-Path $env:ProgramFiles 'PawnIO\uninstall.exe'
if (Test-Path $un) {
  Say "`n[1/3] Removendo a instalação anterior do PawnIO..." Cyan
  $p = Start-Process $un -ArgumentList '-uninstall', '-silent' -Wait -PassThru
  Say "      concluído (código $($p.ExitCode))"
  Start-Sleep -Seconds 2
} else {
  Say "`n[1/3] Nenhuma instalação anterior encontrada." Cyan
}

Say "`n[2/3] Instalando o PawnIO (winget)..." Cyan
winget install --id namazso.PawnIO -e --force --accept-package-agreements --accept-source-agreements
$code = $LASTEXITCODE

Say "`n[3/3] Conferindo o driver..." Cyan
Start-Sleep -Seconds 2
if ([PawnDev]::Loaded()) {
  Say "`nPronto! O driver PawnIO está funcionando." Green
  Say "Volte ao InfoHardware e clique em 'Reiniciar o motor' (Ajustes) para ver a temperatura e o consumo da CPU."
} else {
  Say "`nO driver ainda não carregou (código do instalador: $code)." Yellow
  $blocked = Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 300 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'pawn' } | Select-Object -First 1
  if ($blocked) {
    Say "O Windows bloqueou o driver:" Yellow
    Say ("  " + $blocked.Message.Split("`n")[0])
    Say "Isso vem das proteções do Windows (Integridade de memória / lista de drivers bloqueados). Sem desligá-las, o PawnIO não roda neste PC."
  } else {
    Say "Reinicie o computador e abra o InfoHardware de novo: alguns drivers só carregam depois de reiniciar."
  }
}
Read-Host "`nAperte Enter para fechar"
