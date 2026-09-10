# Omni Studio 需求集成证据（2026-09-10）

## 对照范围

- 飞书需求表：175 条。
- 远端基线：`github/main` = `1b838ec`，即已合并的 PR #63（视频音频模式与后期混音）。PR #63 不等于 175 条需求全部完成。
- 当前分支：`feature/sflynnn-development`，相对 `github/main` 包含 Source、连续性、Assembly 编辑、Cast 类型候选、视觉手册、FFmpeg 验证、生产 JobItem 接入等后续提交；本轮新增 Take 就绪状态校验和导出延迟清理防护。

## 当前验证结果

- 后端：`720 passed`。
- 前端 build：通过（Next.js 静态导出成功）。
- 前端 typecheck：通过。
- 前端普通测试：46 个文件，294 条通过。
- 前端 UI 测试：58 个文件，225 条通过。
- 真实 FFmpeg/ffprobe：裁切、分辨率、帧率、H.264、AAC、软字幕、转场、merge 校验通过。
- 只读主链浏览器 smoke：8/8 步骤通过。
- 真实可写浏览器验收：登录、旧数据承接、视觉手册保存/刷新/模板/Markdown 下载、Source 导入预览、章节 revision/恢复、章节关联两个 Episode 后解绑、章节分析历史、影响事件确认、Script API 持久化通过。
- 真实 Task Center 浏览器验收：使用 acceptance Workspace 登录，读取跨项目任务列表、状态筛选/分页空态、打开失败任务详情和状态事件历史；点击重试后服务端返回幂等 `409` 并在 UI 显示可恢复错误，不产生重复 provider 调用；另以真实 pending 生产任务验证取消确认、状态变为“已取消”和关联项目跳转。证据截图：`.artifacts/acceptance/task-center-real.png`、`.artifacts/acceptance/task-detail-real.png`、`.artifacts/acceptance/task-retry-real.png`、`.artifacts/acceptance/task-cancel-object-jump-real.png`。
- 本轮浏览器复验：登录、Workspace/Source/Tasks/Playground/Projects 路由、视觉手册保存/刷新/模板/下载、Source 可写导入预览/修订恢复/章节级 Episode 关联与解绑/分析历史/影响确认均通过；证据脚本为 `docs/agents/tools/acceptance_browser_check.py` 和 `docs/agents/tools/live_writable_source_acceptance.py`，输出见 `.artifacts/acceptance/live-source/`。
- Cast 工作台已补齐素材多选、质检就绪统计以及系列素材批量锁定/解锁；前端集成测试覆盖选择两项并断言批量 API 请求。使用 acceptance 账号真实浏览器进入专用 `workflow_mode=r2v` 项目后，检测到 `11` 个素材复选框、`4/11` 质检就绪，勾选两项后选择计数与批量锁定/解锁控件均出现；截图见 `.artifacts/acceptance/cast-browser/cast-workbench.png`。
- 本轮新增 Provider 连通性测试：设置页真实 Chromium 点击“测试当前 Provider”后可看到“仅连通性探测 · 预计费用 0”风险提示；后端覆盖未配置凭证、成功探测、错误分类和敏感信息脱敏。证据截图：`.artifacts/acceptance/provider-cast/provider-test.png`。
- 本轮新增 AI 音色推荐：后端返回可解释 `reasons` 且明确 `selection_requires_confirmation`，Voice Picker 保留试听与 Apply 确认，不自动写入角色；相关前后端测试通过。
- 本轮新增 Cast 批量结果与取消语义：批次展示 pending/succeeded/failed/canceled，取消调用统一 Task API 并将未完成项计入 canceled；项目级资产生成响应补充 `_job_id`，保证真实取消链路可用。相关前后端测试通过。

## PR #64 复核纠偏

本轮对照 `github/main` 与当前分支代码后，确认旧版缺口分析中以下条目已经在 PR #64 及其父提交中落地，不能继续按“未实现”统计：

- `SRC-00/04/05/09`：Source CRUD、章节级 Episode 关系、revision 恢复和目标级影响确认。
- `STYLE-03/04/05/06`、`DIR-01/02/03/04/05`：系列继承、视觉手册、AI 风格推荐预览/确认、Director Plan 继承/来源链/确认。
- `CAST-07/08/10/13`：类型化候选、批量质检与锁定、生成预览费用提示、当前候选和工作台操作。
- `SHOT-09/10/14`、`VIDEO-10/11`：连续性账本、生成前 readiness、显式 Take 门控和下载 manifest。
- `ASM-01/02/03/04/05/07/08/09/10/12`：显式 Take 预检、非破坏性裁切/分段编辑、真实 FFmpeg 混音/转场/编码、磁盘预检与失败上下文。
- `TASK-08/09/10/11/12/13`：生产入口 Job/JobItem、Playground 纳入统一任务账本、恢复派发、取消/重试和 retry lineage。

这些条目均有后端/前端自动化覆盖，且本轮全量门禁通过；仍需补的是 owner/editor/viewer、跨 Workspace 媒体、真实外部 Provider 以及登录过期等环境矩阵，不应把 fixture 或本地 deterministic provider 误报成线上 Provider 验收。

真实可写 Source 证据：`.artifacts/acceptance/live-source/run.json`、`.artifacts/acceptance/live-source/source-final.png`。

## 本轮补齐

- 章节 Episode 选择测试改为 HeroUI Select 的真实可访问语义。
- FFmpeg 帧提取显式使用 UTF-8 + `errors=replace`，消除 Windows GBK 线程解码异常。
- `generate_assets`、Motion Reference、资产视频、视频重试接入 `ProductionJobAdapter`；批量素材新增 `asset_batch` JobItem 类型，保留 retry lineage。
- 品牌图标补充宽高比例声明和 above-the-fold `priority`，消除浏览器尺寸/LCP 警告。
- `generate_storyboard`、`generate_video`、对白批量、对白单句、SFX 批量入口统一通过 `ProductionJobAdapter`；任务中心取消/重试/恢复继续复用同一 Job/JobItem 状态机。新增 `tests/test_production_entrypoints.py` 5 条真实 API 回归，连同受影响 W2/Task/Adapter 测试共 `114 passed`。
- 真实专业格式结构验收已覆盖 PDF、DOCX、FDX、Fountain、TXT：PDF 头与字体、DOCX `word/document.xml`、FDX XML 段落类型与转义、Fountain 场景/对白语义、TXT 内容和 MIME/扩展名均有断言；相关导出回归 `35 passed`。
- 前端门禁：普通测试 `45 个文件 / 290 条通过`；UI 测试 `58 个文件 / 220 条通过`；typecheck 与 Next.js 静态 build 均通过。修复了导出下载锚点在卸载后延迟清理导致的 `document is not defined` 未处理异常，并新增可用 Take 计数回归。

## 明确延期或仍需后续集成矩阵

以下三项按产品计划明确延期，不应伪装成已完成：

- `AUDIO-10`：真正视觉口型同步。
- `ASM-15`：完整 NLE（多轨、关键帧、滤镜）。
- `MODEL-06`：动态 Provider 代码/URL/TypeScript 注入。

后续集成测试仍应覆盖：owner/editor/viewer 完整浏览器矩阵、跨 Workspace 媒体访问、登录过期、Task Center 真实取消/对象跳转、真实外部 Provider 生成、导出磁盘不足与失败中间结果保留。专业格式导出的结构和内容验收已完成；真实 Provider 仍受外部凭据/配额约束，不能用 fixture 结果冒充线上 provider 通过。

因此当前代码已达到“可以进入下一步集成测试”的门槛，但不能据此声称 175 条（扣除三项延期）已经完成全部环境验收；外部 Provider 凭证/配额、owner/editor/viewer 矩阵、跨 Workspace 媒体和登录过期仍需在集成环境继续执行。
