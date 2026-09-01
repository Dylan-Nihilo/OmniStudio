# Omni Studio 用户手册

> 作者：星莲(StarLotus，张钧贺)

## 📋 目录

1. [快速开始](#-快速开始)
2. [API 密钥配置](#-api-密钥配置)
3. [OSS 存储配置（可选）](#-oss-存储配置可选)
4. [日志查看](#-日志查看)
5. [常见问题](#-常见问题)

---

## 🚀 快速开始

### 首次启动（仅限应用打包方式）

1. **双击应用图标**启动 Omni Studio
2. 应用会自动打开**设置页面**
3. 按照提示完成 **API 密钥配置**

### 应用数据目录

所有用户数据存储在以下位置：

| 系统 | 路径 |
|------|------|
| macOS / Linux | `~/.omni-studio/` |
| Windows | `C:\Users\<用户名>\.omni-studio\` |

---

## 🔑 API 密钥配置

Omni Studio 使用阿里云灵积平台(DashScope)提供 AI 能力。

### 获取 API Key

1. 访问 [阿里云灵积平台](https://dashscope.aliyun.com/)
2. 登录您的阿里云账号（没有账号请先注册）
3. 进入 **控制台** → **API-KEY 管理**
4. 点击 **创建新的 API-KEY**
5. 复制生成的 API Key

### 在应用中配置

1. 启动 Omni Studio
2. 点击左上角 **设置图标** ⚙️
3. 找到 **DASHSCOPE_API_KEY** 输入框
4. 粘贴您的 API Key
5. 点击 **保存**

> ⚠️ **重要**：请妥善保管您的 API Key，不要泄露给他人。

---

## 🧩 运行模式说明（含必填项）

Omni Studio 的媒体存储是 **本地优先**：

- 所有素材先落盘到 `output/`；
- OSS 仅在你配置后作为“可选镜像 + 签名 URL”使用；
- Kling/Vidu 默认跟随 DashScope，可按需切到原厂。

### 模式 1：DashScope-only（推荐起步）

- 适用：不配置 OSS，不走 Kling/Vidu 原厂。
- 必填：
  - `DASHSCOPE_API_KEY`

### 模式 2：DashScope + OSS（可选增强）

- 适用：希望保留本地文件，同时在 OSS 做镜像和 URL 服务。
- 必填：
  - `DASHSCOPE_API_KEY`
  - `ALIBABA_CLOUD_ACCESS_KEY_ID`
  - `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
  - `OSS_BUCKET_NAME`
  - `OSS_ENDPOINT`
- 可选：
  - `OSS_BASE_PATH`

### 模式 3：DashScope-first + Kling 原厂

- 适用：仅 Kling 走原厂，其它继续走 DashScope。
- 必填：
  - `DASHSCOPE_API_KEY`
  - `KLING_PROVIDER_MODE=vendor`
  - `KLING_ACCESS_KEY`
  - `KLING_SECRET_KEY`

### 模式 4：DashScope-first + Vidu 原厂

- 适用：仅 Vidu 走原厂，其它继续走 DashScope。
- 必填：
  - `DASHSCOPE_API_KEY`
  - `VIDU_PROVIDER_MODE=vendor`
  - `VIDU_API_KEY`

> 提示：是否配置 OSS 与是否选择 Kling/Vidu 原厂是两个独立开关，可组合使用。

---

## ☁️ OSS 存储配置（可选）

OSS 配置用于云端存储生成的资产，适合团队协作或跨设备使用。

### 获取 OSS 配置信息

1. 访问 [阿里云 OSS 控制台](https://oss.console.aliyun.com/)
2. 创建或选择一个 **Bucket**
3. 记录以下信息：
   - **Bucket 名称**
   - **Endpoint**（如 `oss-cn-beijing.aliyuncs.com`）
4. 在 **RAM 访问控制** 中创建 AccessKey

### 在应用中配置

在设置页面填写以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| ALIBABA_CLOUD_ACCESS_KEY_ID | AccessKey ID | `LTAI5t...` |
| ALIBABA_CLOUD_ACCESS_KEY_SECRET | AccessKey Secret | `xxxxxx...` |
| OSS_BUCKET_NAME | Bucket 名称 | `my-omni_studio-bucket` |
| OSS_ENDPOINT | OSS 地域节点 | `oss-cn-beijing.aliyuncs.com` |
| OSS_BASE_PATH | 存储路径前缀 | `omni_studio` |

---

## 📋 日志查看

当遇到问题时，日志文件可帮助排查原因。

### 日志文件位置

| 系统 | 路径 |
|------|------|
| macOS / Linux | `~/.omni-studio/logs/app.log` |
| Windows | `C:\Users\<用户名>\.omni-studio\logs\app.log` |

### 打开日志目录

**macOS**：
1. 打开 Finder
2. 按 `Cmd + Shift + G`
3. 输入 `~/.omni-studio/logs` 并回车

**Windows**：
1. 打开资源管理器
2. 在地址栏输入 `%USERPROFILE%\.omni-studio\logs`
3. 按回车

### 如何提交问题报告

如需技术支持，请提供：
1. **app.log** 文件（或其中的错误部分）
2. 操作步骤描述

---

## ❓ 常见问题

### Q: 为什么需要配置 API Key？

A: Omni Studio 使用阿里云灵积平台的 AI 模型进行图像和视频生成。API Key 用于验证您的身份并计费。

### Q: OSS 配置失败怎么办？

请检查：
1. AccessKey ID 和 Secret 是否正确
2. Bucket 名称是否存在
3. Endpoint 格式是否正确（不需要 `https://` 前缀）
4. RAM 权限是否包含 OSS 读写权限

### Q: 生成失败如何排查？

1. 查看日志文件中的错误信息
2. 检查 API Key 是否过期或余额不足
3. 确认网络连接正常

### Q: 如何清理缓存？

删除 `~/.omni-studio/` 目录下的 `webview_storage` 文件夹，然后重启应用。

---

## 📞 获取帮助

如有问题，请联系本项目开发者 星莲（StarLotus，张钧贺） 或查看项目 README 文档。
