$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Write-IcoFromPng {
  param(
    [string]$PngPath,
    [string]$IcoPath
  )

  [byte[]]$pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
  $stream = New-Object System.IO.FileStream($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = New-Object System.IO.BinaryWriter($stream)

  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngBytes.Length)
    $writer.Write([UInt32]22)
    $writer.Write($pngBytes)
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$root = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $root "build"

if (-not (Test-Path $buildDir)) {
  New-Item -ItemType Directory -Path $buildDir | Out-Null
}

$pngPath = Join-Path $buildDir "icon.png"
$icoPath = Join-Path $buildDir "icon.ico"

$size = 256
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $backgroundPath = New-RoundedRectanglePath -X 14 -Y 14 -Width 228 -Height 228 -Radius 54
  $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 14, 20),
    (New-Object System.Drawing.Point 242, 242),
    ([System.Drawing.ColorTranslator]::FromHtml("#d56b1e")),
    ([System.Drawing.ColorTranslator]::FromHtml("#8e3d00"))
  )
  $graphics.FillPath($backgroundBrush, $backgroundPath)

  $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(46, 255, 247, 235))
  $graphics.FillEllipse($glowBrush, 32, 26, 132, 86)

  $panelPath = New-RoundedRectanglePath -X 40 -Y 46 -Width 176 -Height 164 -Radius 34
  $panelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#fff9ef"))
  $panelBorder = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#ead8c0"), 4)
  $graphics.FillPath($panelBrush, $panelPath)
  $graphics.DrawPath($panelBorder, $panelPath)

  $accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#b65100"))
  $accentPath = New-RoundedRectanglePath -X 176 -Y 62 -Width 24 -Height 54 -Radius 10
  $graphics.FillPath($accentBrush, $accentPath)

  $shelfPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#2e2418"), 8)
  $shelfPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $shelfPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($shelfPen, 68, 188, 188, 188)

  $font = New-Object System.Drawing.Font("Segoe UI", 60, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#2e2418"))
  $stringFormat = New-Object System.Drawing.StringFormat
  $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF(48, 70, 148, 86)
  $graphics.DrawString("MW", $font, $textBrush, $textRect, $stringFormat)

  $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#fff7eb"))
  $graphics.FillEllipse($dotBrush, 192, 180, 18, 18)

  $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-IcoFromPng -PngPath $pngPath -IcoPath $icoPath
}
finally {
  if ($null -ne $stringFormat) { $stringFormat.Dispose() }
  if ($null -ne $font) { $font.Dispose() }
  if ($null -ne $textBrush) { $textBrush.Dispose() }
  if ($null -ne $shelfPen) { $shelfPen.Dispose() }
  if ($null -ne $dotBrush) { $dotBrush.Dispose() }
  if ($null -ne $accentBrush) { $accentBrush.Dispose() }
  if ($null -ne $accentPath) { $accentPath.Dispose() }
  if ($null -ne $panelBorder) { $panelBorder.Dispose() }
  if ($null -ne $panelBrush) { $panelBrush.Dispose() }
  if ($null -ne $panelPath) { $panelPath.Dispose() }
  if ($null -ne $glowBrush) { $glowBrush.Dispose() }
  if ($null -ne $backgroundBrush) { $backgroundBrush.Dispose() }
  if ($null -ne $backgroundPath) { $backgroundPath.Dispose() }
  $graphics.Dispose()
  $bitmap.Dispose()
}
