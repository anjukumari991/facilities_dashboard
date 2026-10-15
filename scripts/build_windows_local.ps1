param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')]
    [string]$Version = "0.0.0-dev+local",
    [switch]$SkipTests,
    [switch]$RecreateEnvironment
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepositoryDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvironmentDirectory = Join-Path $RepositoryDirectory ".venv-windows-build"
$EnvironmentPython = Join-Path $EnvironmentDirectory "Scripts\python.exe"
$BuildDirectory = Join-Path $RepositoryDirectory "build"
$RuntimeArchive = Join-Path $BuildDirectory "llama-b11429-bin-win-cpu-x64.zip"
$RuntimeExtractDirectory = Join-Path $BuildDirectory "llama-runtime-extracted"
$RuntimeBundleDirectory = Join-Path $BuildDirectory "llama-runtime-bundle"
$PyInstallerWorkDirectory = Join-Path $BuildDirectory "pyinstaller-windows"
$PyInstallerDistDirectory = Join-Path $BuildDirectory "windows-dist"
$OutputDirectory = Join-Path $RepositoryDirectory "dist\windows-local"
$VersionFile = Join-Path $RepositoryDirectory "dashboard\_build_version.py"
$IconFile = Join-Path $BuildDirectory "app-icon.ico"

$RuntimeUrl = "https://github.com/ggml-org/llama.cpp/releases/download/b11429/llama-b11429-bin-win-cpu-x64.zip"
$RuntimeSha256 = "1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
    }
}

function Get-BootstrapPython {
    $launcher = Get-Command "py.exe" -ErrorAction SilentlyContinue
    if ($launcher) {
        & $launcher.Source -3.12 -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
        if ($LASTEXITCODE -eq 0) {
            return @{ Executable = $launcher.Source; Arguments = @("-3.12") }
        }
    }
    $python = Get-Command "python.exe" -ErrorAction SilentlyContinue
    if ($python) {
        & $python.Source -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
        if ($LASTEXITCODE -eq 0) {
            return @{ Executable = $python.Source; Arguments = @() }
        }
    }
    throw "Python 3.12 x64 was not found. Install it from python.org, including the Python Launcher, then run this script again."
}

function Install-PinnedRuntime {
    New-Item -ItemType Directory -Force $BuildDirectory | Out-Null
    $downloadRequired = $true
    if (Test-Path $RuntimeArchive) {
        $existingHash = (Get-FileHash $RuntimeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
        $downloadRequired = $existingHash -ne $RuntimeSha256
        if ($downloadRequired) {
            Remove-Item -Force $RuntimeArchive
        }
    }
    if ($downloadRequired) {
        Write-Host "Downloading the pinned Windows local-AI runtime..."
        Invoke-WebRequest -Uri $RuntimeUrl -OutFile $RuntimeArchive
    }
    $actualHash = (Get-FileHash $RuntimeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $RuntimeSha256) {
        throw "The llama.cpp runtime checksum did not match the pinned release."
    }

    Remove-Item -Recurse -Force $RuntimeExtractDirectory, $RuntimeBundleDirectory -ErrorAction SilentlyContinue
    Expand-Archive -Path $RuntimeArchive -DestinationPath $RuntimeExtractDirectory -Force
    $server = Get-ChildItem $RuntimeExtractDirectory -Recurse -Filter "llama-server.exe" | Select-Object -First 1
    if (-not $server) {
        throw "The pinned llama.cpp archive does not contain llama-server.exe."
    }
    New-Item -ItemType Directory -Force $RuntimeBundleDirectory | Out-Null
    Copy-Item -Path (Join-Path $server.Directory.FullName "*") -Destination $RuntimeBundleDirectory -Recurse -Force
    if (-not (Get-ChildItem $RuntimeBundleDirectory -Filter "*.dll" -File)) {
        throw "The pinned llama.cpp runtime DLLs were not found."
    }
    Invoke-Checked -Executable (Join-Path $RuntimeBundleDirectory "llama-server.exe") -Arguments @("--version")
}

Set-Location $RepositoryDirectory
Write-Host "Building Facilities Dashboard $Version for Windows x64"

if ($RecreateEnvironment -and (Test-Path $EnvironmentDirectory)) {
    Remove-Item -Recurse -Force $EnvironmentDirectory
}

if (-not (Test-Path $EnvironmentPython)) {
    $bootstrap = Get-BootstrapPython
    Write-Host "Creating the isolated Python 3.12 build environment..."
    Invoke-Checked -Executable $bootstrap.Executable -Arguments ($bootstrap.Arguments + @("-m", "venv", $EnvironmentDirectory))
}

Invoke-Checked -Executable $EnvironmentPython -Arguments @(
    "-c",
    "import platform, struct, sys; assert sys.version_info[:2] == (3, 12), sys.version; assert struct.calcsize('P') * 8 == 64, platform.architecture(); print(sys.version); print('Architecture:', platform.machine())"
)
Invoke-Checked -Executable $EnvironmentPython -Arguments @("-m", "pip", "install", "--upgrade", "pip")
Invoke-Checked -Executable $EnvironmentPython -Arguments @(
    "-m", "pip", "install",
    "-r", (Join-Path $RepositoryDirectory "dashboard\requirements.txt"),
    "pyinstaller", "pillow"
)

Install-PinnedRuntime

if (-not $SkipTests) {
    Write-Host "Running the test suite..."
    Invoke-Checked -Executable $EnvironmentPython -Arguments @("-m", "unittest", "discover", "-s", "tests", "-v")
}

Write-Host "Preparing the Windows application icon..."
$iconCommand = @"
from PIL import Image, ImageOps
image = Image.open(r'$RepositoryDirectory\dashboard\static\app-icon.png').convert('RGBA')
square = ImageOps.pad(image, (512, 512), color=(4, 43, 66, 255))
square.save(r'$IconFile', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
"@
Invoke-Checked -Executable $EnvironmentPython -Arguments @("-c", $iconCommand)

$versionFileExisted = Test-Path $VersionFile
$originalVersionBytes = if ($versionFileExisted) { [IO.File]::ReadAllBytes($VersionFile) } else { $null }
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

try {
    [IO.File]::WriteAllText($VersionFile, "APP_VERSION = `"$Version`"`n", $utf8WithoutBom)
    Remove-Item -Recurse -Force $PyInstallerWorkDirectory, $PyInstallerDistDirectory -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $PyInstallerWorkDirectory, $PyInstallerDistDirectory | Out-Null

    Write-Host "Building the single-file executable..."
    $pyInstallerArguments = @(
        "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name", "facilities_dashboard",
        "--paths", (Join-Path $RepositoryDirectory "dashboard"),
        "--add-data", "$(Join-Path $RepositoryDirectory 'dashboard\static');static",
        "--icon", $IconFile,
        "--collect-data", "webview",
        "--collect-all", "keyring",
        "--collect-all", "openai",
        "--add-binary", "$(Join-Path $RuntimeBundleDirectory 'llama-server.exe');bin",
        "--add-binary", "$(Join-Path $RuntimeBundleDirectory '*.dll');bin",
        "--hidden-import", "webview.platforms.qt",
        "--workpath", $PyInstallerWorkDirectory,
        "--distpath", $PyInstallerDistDirectory,
        "--specpath", $BuildDirectory,
        (Join-Path $RepositoryDirectory "dashboard\desktop_app.py")
    )
    Invoke-Checked -Executable $EnvironmentPython -Arguments $pyInstallerArguments
}
finally {
    if ($versionFileExisted) {
        [IO.File]::WriteAllBytes($VersionFile, $originalVersionBytes)
    }
    elseif (Test-Path $VersionFile) {
        Remove-Item -Force $VersionFile
    }
}

$builtExecutable = Join-Path $PyInstallerDistDirectory "facilities_dashboard.exe"
if (-not (Test-Path $builtExecutable)) {
    throw "PyInstaller completed without creating facilities_dashboard.exe."
}

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$outputExecutable = Join-Path $OutputDirectory "facilities_dashboard.exe"
$outputChecksum = Join-Path $OutputDirectory "facilities_dashboard.exe.sha256"
Copy-Item -Force $builtExecutable $outputExecutable
$hash = (Get-FileHash $outputExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($outputChecksum, "$hash  facilities_dashboard.exe`n", [Text.Encoding]::ASCII)

$sizeMb = [Math]::Round((Get-Item $outputExecutable).Length / 1MB, 1)
Write-Host ""
Write-Host "Build completed successfully." -ForegroundColor Green
Write-Host "Executable: $outputExecutable ($sizeMb MB)"
Write-Host "Checksum:   $outputChecksum"
Write-Host "SHA-256:    $hash"
