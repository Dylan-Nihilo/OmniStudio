# Omni Studio 需求集成证据（2026-09-10）

## 对照范围

- 飞书需求表：175 条。
- 远端基线：`github/main` = `1b838ec`，即已合并的 PR #63（视频音频模式与后期混音）。PR #63 不等于 175 条需求全部完成。
- 当前分支：`feature/sflynnn-development`，相对 `github/main` 包含 Source、连续性、Assembly 编辑、Cast 类型候选、视觉手册、FFmpeg 验证、生产 JobItem 接入等后续提交。

## 当前验证结果

- 后端：`695 passed, 106 warnings`。
- 前端 build：通过（Next.js 静态导出成功）。
- 前端 typecheck：通过。
- 前端普通测试：45 个文件，288 条通过。
- 前端 UI 测试：58 个文件，218 条通过。
- 真实 FFmpeg/ffprobe：裁切、分辨率、帧率、H.264、AAC、软字幕、转场、merge 校验通过。
- 只读主链浏览器 smoke：8/8 步骤通过。
- 真实可写浏览器验收：登录、旧数据承接、视觉手册保存/刷新/模板/Markdown 下载、Source 导入预览、章节 revision/恢复、章节关联两个 Episode 后解绑、章节分析历史、影响事件确认、Script API 持久化通过。

真实可写 Source 证据：`.artifacts/acceptance/live-source/run.json`、`.artifacts/acceptance/live-source/source-final.png`。

## 本轮补齐

- 章节 Episode 选择测试改为 HeroUI Select 的真实可访问语义。
- FFmpeg 帧提取显式使用 UTF-8 + `errors=replace`，消除 Windows GBK 线程解码异常。
- `generate_assets`、Motion Reference、资产视频、视频重试接入 `ProductionJobAdapter`；批量素材新增 `asset_batch` JobItem 类型，保留 retry lineage。
- 品牌图标补充宽高比例声明和 above-the-fold `priority`，消除浏览器尺寸/LCP 警告。

## 明确延期或仍需后续集成矩阵

以下三项按产品计划明确延期，不应伪装成已完成：

- `AUDIO-10`：真正视觉口型同步。
- `ASM-15`：完整 NLE（多轨、关键帧、滤镜）。
- `MODEL-06`：动态 Provider 代码/URL/TypeScript 注入。

后续集成测试仍应覆盖：owner/editor/viewer 完整浏览器矩阵、跨 Workspace 媒体访问、登录过期、Task Center 取消/重试/跳转、真实 Provider 生成、导出磁盘不足与失败中间结果保留，以及 PDF/DOCX/FDX/Fountain 专业格式导出。当前这些不是本轮回归失败，而是尚未具备真实外部 Provider 或完整浏览器证据的验收项。

因此当前代码已达到“可以进入下一步集成测试”的门槛，但不能据此声称 175 条（扣除三项延期）已经全部完成验收。
