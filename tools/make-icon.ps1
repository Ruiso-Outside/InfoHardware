# Gera o ícone neon (chip + linha de pulso) em vários tamanhos e monta o .ico (entradas PNG).
param([string]$OutDir = "$PSScriptRoot\..\src\InfoHardware\Assets")

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0

    # Fundo
    $bg = New-RoundRect (8*$s) (8*$s) (240*$s) (240*$s) (52*$s)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0,0), (New-Object System.Drawing.PointF $size,$size), ([System.Drawing.Color]::FromArgb(255,30,12,58)), ([System.Drawing.Color]::FromArgb(255,10,5,22))
    $g.FillPath($bgBrush, $bg)
    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,168,85,247)), ([Math]::Max(1, 6*$s))
    $g.DrawPath($borderPen, $bg)

    # Pinos do chip
    $pinBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,200,140,255))
    foreach ($i in 0..3) {
        $o = (78 + $i * 30) * $s
        $g.FillRectangle($pinBrush, $o, 44*$s, 12*$s, 22*$s)
        $g.FillRectangle($pinBrush, $o, 190*$s, 12*$s, 22*$s)
        $g.FillRectangle($pinBrush, 44*$s, $o, 22*$s, 12*$s)
        $g.FillRectangle($pinBrush, 190*$s, $o, 22*$s, 12*$s)
    }

    # Corpo do chip
    $chip = New-RoundRect (64*$s) (64*$s) (128*$s) (128*$s) (20*$s)
    $chipBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF (64*$s),(64*$s)), (New-Object System.Drawing.PointF (192*$s),(192*$s)), ([System.Drawing.Color]::FromArgb(255,168,85,247)), ([System.Drawing.Color]::FromArgb(255,255,60,172))
    $g.FillPath($chipBrush, $chip)
    $inner = New-RoundRect (78*$s) (78*$s) (100*$s) (100*$s) (12*$s)
    $innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,18,8,36))
    $g.FillPath($innerBrush, $inner)

    # Linha de pulso ciano
    $pulsePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255,34,211,238)), ([Math]::Max(1.5, 9*$s))
    $pulsePen.LineJoin = 'Round'; $pulsePen.StartCap = 'Round'; $pulsePen.EndCap = 'Round'
    $pts = @(
        (New-Object System.Drawing.PointF (86*$s),(134*$s)),
        (New-Object System.Drawing.PointF (108*$s),(134*$s)),
        (New-Object System.Drawing.PointF (120*$s),(102*$s)),
        (New-Object System.Drawing.PointF (136*$s),(156*$s)),
        (New-Object System.Drawing.PointF (148*$s),(124*$s)),
        (New-Object System.Drawing.PointF (170*$s),(124*$s))
    )
    $g.DrawLines($pulsePen, [System.Drawing.PointF[]]$pts)
    $g.Dispose()
    return $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($sz in $sizes) {
    $bmp = New-IconBitmap $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($sz -eq 256) { $bmp.Save((Join-Path $OutDir 'logo.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    $bmp.Dispose()
    $pngs += , $ms.ToArray()
}

$fs = [System.IO.File]::Create((Join-Path $OutDir 'app.ico'))
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]; $len = $pngs[$i].Length
    $dim = if ($sz -ge 256) { 0 } else { $sz }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]$len); $bw.Write([uint32]$offset)
    $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()
Write-Host "Ícone gerado em $OutDir"
