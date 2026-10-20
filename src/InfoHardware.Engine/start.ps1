# Inicia o motor de sensores do módulo InfoHardware (Piphin Hub) dentro do PowerShell do Windows.
#   powershell -File start.ps1 -Dir <pasta do motor> -Port <porta> -Token <código> -Parent <PID do módulo>
param([string]$Dir, [int]$Port, [string]$Token, [int]$Parent)
$ErrorActionPreference = 'Stop'
try {
  [Reflection.Assembly]::UnsafeLoadFrom((Join-Path $Dir 'InfoHardware.Engine.dll')) | Out-Null
  [InfoHardware.Engine.Host]::Run($Dir, $Port, $Token, $Parent)
} catch {
  $msg = $_.Exception.GetBaseException().ToString()
  $log = Join-Path $env:TEMP 'piphin-infohardware-engine.log'
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format s), $msg)
  exit 1
}
