$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$installerAssetRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri'))
$installerSvg = [xml](Get-Content -LiteralPath (Join-Path $PSScriptRoot '../public/pi.svg') -Raw)
$installerViewBox = @($installerSvg.svg.viewBox.Split(' ') | ForEach-Object { [double]$_ })

function Draw-PiMark {
    param($Graphics, [double]$X, [double]$Y, [double]$Size)

    # Read the existing axis-aligned SVG paths directly; never resample a small PNG.
    foreach ($shape in $installerSvg.svg.path) {
        $tokens = [regex]::Matches($shape.d, '[A-Za-z]|-?\d+(?:\.\d+)?')
        $points = [System.Collections.Generic.List[System.Drawing.Point]]::new()
        $pointX = 0.0
        $pointY = 0.0
        for ($index = 0; $index -lt $tokens.Count;) {
            $command = $tokens[$index++].Value
            switch -CaseSensitive ($command) {
                'M' { $pointX = [double]$tokens[$index++].Value; $pointY = [double]$tokens[$index++].Value }
                'H' { $pointX = [double]$tokens[$index++].Value }
                'V' { $pointY = [double]$tokens[$index++].Value }
                'Z' { continue }
                default { throw "Unsupported Pi SVG path command: $command" }
            }
            if ($command -ne 'Z') {
                $points.Add([System.Drawing.Point]::new(
                    [int][Math]::Round($X + ($pointX - $installerViewBox[0]) * $Size / $installerViewBox[2]),
                    [int][Math]::Round($Y + ($pointY - $installerViewBox[1]) * $Size / $installerViewBox[3])
                ))
            }
        }
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($shape.fill))
        try { $Graphics.FillPolygon($brush, $points.ToArray()) } finally { $brush.Dispose() }
    }
}

function Write-InstallerBitmap {
    param([string]$Name, [int]$Width, [int]$Height, [scriptblock]$Draw)

    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    try {
        & $Draw $graphics
        $bitmap.Save((Join-Path $installerAssetRoot "installer/$Name.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

Write-InstallerBitmap 'header' 192 192 {
    param($graphics)
    $graphics.Clear([System.Drawing.Color]::White)
    Draw-PiMark $graphics 0 0 192
}
Write-InstallerBitmap 'sidebar' 492 846 {
    param($graphics)
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F4F3F1'))
    Draw-PiMark $graphics 48 96 144
    foreach ($accent in @(@('#F09082', 72), @('#4D9ABF', 120), @('#F1BE58', 168))) {
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($accent[0]))
        try { $graphics.FillRectangle($brush, [int]$accent[1], 774, 24, 24) } finally { $brush.Dispose() }
    }
}

& (Join-Path $PSScriptRoot 'generate-installer-ui.ps1')
