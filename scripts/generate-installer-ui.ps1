$ErrorActionPreference = 'Stop'
$installerSourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src-tauri/installer'))
$installerWorkRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../work/installer-assets'))
New-Item -ItemType Directory -Path $installerWorkRoot -Force | Out-Null

$installerSdkRoot = Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -Name KitsRoot10
$installerSdkVersion = Get-ChildItem -LiteralPath (Join-Path $installerSdkRoot 'bin') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'x64/rc.exe')) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $installerSdkVersion) { throw '缺少 Windows SDK 资源编译器。' }
$installerRc = Join-Path $installerSdkRoot "bin/$installerSdkVersion/x64/rc.exe"
$installerVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$installerLink = @(& $installerVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe')[0]
if (-not $installerLink) { throw '缺少 MSVC 链接器。' }
$installerResource = Join-Path $installerWorkRoot 'compact-ui.res'
$installerVcInclude = Join-Path ([System.IO.Path]::GetFullPath((Join-Path (Split-Path $installerLink) '../../..'))) 'include'

& $installerRc /nologo /I (Join-Path $installerSdkRoot "Include/$installerSdkVersion/um") /I (Join-Path $installerSdkRoot "Include/$installerSdkVersion/shared") /I (Join-Path $installerSdkRoot "Include/$installerSdkVersion/ucrt") /I $installerVcInclude /fo $installerResource (Join-Path $installerSourceRoot 'compact-ui.rc')
if ($LASTEXITCODE -ne 0) { throw '安装器窗口资源编译失败。' }
# This DLL contains resources only. NSIS copies its dialogs; it never runs code from it.
& $installerLink /nologo /dll /noentry /machine:x86 /nodefaultlib /manifest:no /brepro "/out:$(Join-Path $installerSourceRoot 'compact-ui.dll')" $installerResource
if ($LASTEXITCODE -ne 0) { throw '安装器窗口资源链接失败。' }
