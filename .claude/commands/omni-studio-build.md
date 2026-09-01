---
description: Omni Studio 桌面应用构建流程 - macOS DMG 和 Windows EXE 打包
---

# Omni Studio 桌面应用构建

此 skill 用于将 Omni Studio 打包为桌面应用分发包。

## 前置条件

**通用:**
- Python 3.11+
- Node.js 18+ (npm)
- FFmpeg

**macOS 额外:**
- Xcode Command Line Tools
- `brew install ffmpeg`（如未安装）

**Windows 额外:**
- PowerShell 5.1+
- Edge WebView2 Runtime

## macOS 构建 (.dmg)

### 1. 确保构建脚本有执行权限

```bash
chmod +x build_mac.sh
```

### 2. 执行构建

```bash
./build_mac.sh
```

**构建流程:**
1. 构建 Next.js 前端为静态文件 → `static/`
2. 创建 Python 虚拟环境
3. 安装 Python 依赖
4. 准备 FFmpeg 二进制
5. PyInstaller 打包为 .app
6. 创建 DMG 安装包

### 3. 输出位置

```
dist_mac/Omni Studio.app   # macOS 应用
dist_mac/Omni Studio.dmg   # DMG 安装包（分发用）
```

### 4. 测试

```bash
open "dist_mac/Omni Studio.app"
```

### macOS 常见问题

| 问题 | 解决方案 |
|------|---------|
| FFmpeg 未找到 | `brew install ffmpeg` |
| DMG 创建失败 | 卸载已挂载的 DMG: `hdiutil detach "/Volumes/Omni Studio"` |
| 签名错误 | 首次运行需右键→打开，绕过 Gatekeeper |

## Windows 构建 (.exe)

### 1. 在 PowerShell 中执行

```powershell
.\build_windows.ps1
```

**构建流程:**
1. 构建 Next.js 前端为静态文件
2. 创建 Python 虚拟环境
3. 安装 Python 依赖
4. 准备 FFmpeg
5. PyInstaller 打包为 .exe

### 2. 输出位置

```
dist_windows\Omni Studio.exe   # Windows 可执行文件
```

### Windows 常见问题

| 问题 | 解决方案 |
|------|---------|
| FFmpeg 未找到 | 下载 FFmpeg 放入 `bin\` 目录或添加到 PATH |
| PowerShell 执行策略 | 管理员 PowerShell: `Set-ExecutionPolicy RemoteSigned` |
| WebView2 错误 | 安装 Edge WebView2 Runtime |

## 构建产物清理

```bash
rm -rf dist/ dist_mac/ dist_windows/ build/ *.spec
rm -rf frontend/.next frontend/out static/
```

## 应用数据路径

打包后应用的用户数据存储在：
- **macOS/Linux:** `~/.omni-studio/`
- **Windows:** `C:\Users\<username>\.omni-studio\`

包含：
- `config.json` — 配置（API Key、OSS 等）
- `logs/` — 运行日志
