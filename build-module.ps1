# Gera o módulo do Piphin Hub: dist\piphin-module-infohardware-<versão>.zip
#   powershell -ExecutionPolicy Bypass -File build-module.ps1
# O módulo leva o motor de sensores (src\InfoHardware.Engine, .NET Framework, roda dentro do PowerShell do
# Windows) e as telas web (module\). A versão é a mesma do app (src\InfoHardware\InfoHardware.csproj).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$stage = Join-Path $root 'out\module'
$dist = Join-Path $root 'dist'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

[xml]$proj = Get-Content "$root\src\InfoHardware\InfoHardware.csproj"
$version = ($proj.Project.PropertyGroup | ForEach-Object { $_.Version } | Where-Object { $_ } | Select-Object -First 1)

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage, $dist, "$stage\icons" | Out-Null

Write-Host '==> Compilando o motor de sensores (.NET Framework 4.7.2)...' -ForegroundColor Magenta
dotnet build "$root\src\InfoHardware.Engine\InfoHardware.Engine.csproj" -c Release -o "$stage\engine" -p:Version=$version -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o motor.' }
Copy-Item "$root\src\InfoHardware.Engine\start.ps1" "$stage\engine\"
# só x64 (o PowerShell do Windows de 64 bits); sobra de outras arquiteturas fica de fora
Remove-Item "$stage\engine\arm64", "$stage\engine\x86" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem "$stage\engine" -Include *.pdb, *.xml -Recurse | Remove-Item -Force

Write-Host '==> Montando o módulo...' -ForegroundColor Magenta
$manifest = Get-Content "$root\module\module.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.version = $version
$manifest | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 "$stage\module.json"
Copy-Item "$root\module\*.js", "$root\module\*.ps1" $stage
Copy-Item "$root\module\web" "$stage\web" -Recurse
# traduções (o Hub aplica na tela e nos avisos); source.jsonl e config.json ficam de fora
New-Item -ItemType Directory -Force "$stage\i18n" | Out-Null
Copy-Item "$root\i18n\*.json" "$stage\i18n" -Exclude config.json
Copy-Item "$root\src\InfoHardware\Assets\logo.png" "$stage\icons\infohardware.png"

$zip = Join-Path $dist "piphin-module-infohardware-$version.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compactar o módulo.' }
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "`nPronto: $zip ($mb MB)" -ForegroundColor Green
