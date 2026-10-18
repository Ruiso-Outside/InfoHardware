# Gera o instalador: dist\InfoHardware-Setup-<versão>.exe
#   powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'out'
$dist = Join-Path $root 'dist'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out, $dist | Out-Null

Write-Host '==> Publicando o InfoHardware (self-contained, win-x64)...' -ForegroundColor Magenta
dotnet publish "$root\src\InfoHardware\InfoHardware.csproj" -c Release -r win-x64 --self-contained true `
    -p:PublishReadyToRun=true -p:DebugType=none -o "$out\app" -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'Falha ao publicar o app.' }

Write-Host '==> Compactando o pacote...' -ForegroundColor Magenta
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = "$out\payload.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory("$out\app", $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '==> Compilando o instalador...' -ForegroundColor Magenta
dotnet build "$root\src\InfoHardware.Setup\InfoHardware.Setup.csproj" -c Release -o "$out\setup" -nologo -v q
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o instalador.' }

$version = (Get-Item "$out\app\InfoHardware.exe").VersionInfo.ProductVersion -replace '\+.*$', ''
$setup = Join-Path $dist "InfoHardware-Setup-$version.exe"

Write-Host '==> Montando o executável final...' -ForegroundColor Magenta
$stub = [System.IO.File]::ReadAllBytes("$out\setup\InfoHardware.Setup.exe")
$payload = [System.IO.File]::ReadAllBytes($zip)
$fs = [System.IO.File]::Create($setup)
$fs.Write($stub, 0, $stub.Length)
$fs.Write($payload, 0, $payload.Length)
$len = [BitConverter]::GetBytes([long]$payload.Length)
$fs.Write($len, 0, 8)
$magic = [System.Text.Encoding]::ASCII.GetBytes('IHPAYLD1')
$fs.Write($magic, 0, 8)
$fs.Close()

$mb = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "`nPronto: $setup ($mb MB)" -ForegroundColor Green
