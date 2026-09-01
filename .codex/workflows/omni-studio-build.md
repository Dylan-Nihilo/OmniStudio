---
name: omni-studio-build
description: Omni Studio desktop build workflow for macOS DMG and Windows EXE packaging.
---

# Omni Studio Desktop Build Workflow

Use this workflow when the user asks to build, package, or prepare a desktop release of Omni Studio for macOS or Windows.

## Prerequisites

Common requirements:

- Python 3.11+
- Node.js 18+
- FFmpeg

macOS-specific:

- Xcode Command Line Tools
- `brew install ffmpeg` if FFmpeg is missing

Windows-specific:

- PowerShell 5.1+
- Edge WebView2 Runtime

## macOS Build (.dmg)

Ensure the build script is executable:

```bash
chmod +x build_mac.sh
```

Run the macOS build:

```bash
./build_mac.sh
```

Expected build flow:

1. Build the Next.js frontend into static assets in `static/`
2. Create a Python virtual environment
3. Install Python dependencies
4. Prepare FFmpeg binaries
5. Package the app with PyInstaller
6. Create the DMG installer

Expected outputs:

```text
dist_mac/Omni Studio.app
dist_mac/Omni Studio.dmg
```

Smoke test:

```bash
open "dist_mac/Omni Studio.app"
```

Common macOS issues:

- FFmpeg missing: `brew install ffmpeg`
- DMG creation failed: `hdiutil detach "/Volumes/Omni Studio"`
- Signing or Gatekeeper issue: open the app via right click and choose Open on first launch

## Windows Build (.exe)

Run the Windows build in PowerShell:

```powershell
.\build_windows.ps1
```

Expected build flow:

1. Build the frontend into static assets
2. Create a Python virtual environment
3. Install Python dependencies
4. Prepare FFmpeg
5. Package the app with PyInstaller

Expected output:

```text
dist_windows\Omni Studio.exe
```

Common Windows issues:

- FFmpeg missing: add FFmpeg to `bin\` or to `PATH`
- PowerShell execution policy: `Set-ExecutionPolicy RemoteSigned`
- WebView2 issue: install Edge WebView2 Runtime

## Clean Build Artifacts

```bash
rm -rf dist/ dist_mac/ dist_windows/ build/ *.spec
rm -rf frontend/.next frontend/out static/
```

## Runtime Data Path

Packaged app data is stored in:

- macOS and Linux: `~/.omni-studio/`
- Windows: `C:\Users\<username>\.omni-studio\`

Typical contents:

- `config.json` for API keys and OSS configuration
- `logs/` for runtime logs
