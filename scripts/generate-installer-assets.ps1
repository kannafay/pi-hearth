$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$installerAssetRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri'))
$installerIcon = [System.Drawing.Image]::FromFile((Join-Path $installerAssetRoot 'icons/icon.png'))

function Write-InstallerBitmap {
    param([string]$Name, [int]$Width, [int]$Height, [scriptblock]$Draw)

    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    try {
        & $Draw $graphics
        $bitmap.Save((Join-Path $installerAssetRoot "installer/$Name.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$installerTitleFont = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$installerBrandFont = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$installerCaptionFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 9)
$installerInk = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#252525'))
$installerMuted = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#727272'))
try {
    Write-InstallerBitmap 'header' 150 57 {
        param($graphics)
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawImage($installerIcon, 5, 13, 30, 30)
        $graphics.DrawString('Pi Hearth', $installerTitleFont, $installerInk, 41, 18)
    }
    Write-InstallerBitmap 'sidebar' 164 314 {
        param($graphics)
        $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F4F3F1'))
        $graphics.DrawImage($installerIcon, 36, 54, 92, 92)
        $graphics.DrawString('Pi Hearth', $installerBrandFont, $installerInk, 19, 169)
        $graphics.DrawString('AI 编程工作台', $installerCaptionFont, $installerMuted, 24, 203)
        foreach ($accent in @(@('#F09082', 24), @('#4D9ABF', 40), @('#F1BE58', 56))) {
            $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($accent[0]))
            try { $graphics.FillRectangle($brush, [int]$accent[1], 272, 8, 8) } finally { $brush.Dispose() }
        }
    }
} finally {
    $installerIcon.Dispose()
    $installerTitleFont.Dispose()
    $installerBrandFont.Dispose()
    $installerCaptionFont.Dispose()
    $installerInk.Dispose()
    $installerMuted.Dispose()
}
