# Changelog

All notable changes to Omni Studio will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.2.1] - 2026-06-09

### Added
- **Qwen 3.7 Plus 支持** — LLM fallback chain 首选升级为 qwen3.7-plus，提示词润色配置新增 3.7 选项（保留 3.6-plus/flash 兼容）

### Changed
- **主视觉焕新** — Logo 与 Banner 从霓虹莲花渐变风格升级为 Cyber Brutalism 棱角几何风格（白色棱角莲花 + 蓝色水晶核心 + 电路纹理），品牌字标改为 monospace 等宽字体
- **侧边栏品牌区** — 去掉渐变文字，改为 monospace "OMNI_STUDIO" + 蓝色 X，Logo 使用无文字版几何 mark
- **默认 LLM 模型** — LLMAdapter/QwenVL 默认模型从 qwen3.6-plus 升级为 qwen3.7-plus

### Fixed
- **GPT-Image-2 edit 模式参数** — `--images` 改为 JSON 数组格式传递，修复参考图生成报错

---

## [1.2.0] - 2026-06-08

### Added
- **Playground 创作台** — 全新独立生成模块，无需创建项目即可使用所有图像/视频生成能力
  - 6 种生成模式：图像（T2I + I2I 自动识别）、文生视频、图生视频、参考生视频、视频编辑
  - 两级模式选择器：图像生成 / 视频生成大类切换 + 视频子模式 pill
  - 模型按 family 分组排序（视频: HappyHorse → Seedance → Kling → PixVerse → Wan → Vidu）
  - 每个模型动态参数（GPT-Image-2: size+quality; Kling: mode+sound+cfgScale; Vidu: movementAmplitude+audio 等）
  - 并发任务队列：可连续提交多个生成任务，右侧画廊实时显示状态
  - 网格/画廊视图切换 + 详情面板（左图右信息，←→ 导航）
  - Prompt 模板管理（新建/套用/收藏/删除）+ Prompt 历史（去重/搜索/一键复制/存为模板）
  - 失败任务：重试 + 删除 + 复制报错全文
  - 资产库双向打通：收藏到资产库（toggle）/ 从资产库选取作为输入
  - 批量生成（抽卡 ×1/×2/×4）
  - Session 时间分割线（30 分钟间隔自动分组）
- **GlobalSidebar 创作台入口** — 侧边栏第 4 个导航项（Sparkles 图标）
- **MuleRun 一键登录** — 设置页一键触发 OAuth 登录 + 重新登录按钮
- **GPT-Image-2 扩展尺寸** — 支持 2K (2048×2048) 和 4K (3840×2160) via MuleRun

### Changed
- **Model catalog 参数精确化** — 所有 27 个 active 模型逐一声明 seed/negativePrompt/promptExtend/watermark 的 true/false，前端按模型动态显示高级参数
- **WanxModel prompt_extend/watermark** — 改为 kwargs 优先读取（修复 Playground 传参被忽略的问题）
- **PixVerse 路由** — Playground service 改为走 WanxModel 通道（与 pipeline 对齐）
- **图像参数体系** — 图像模式显示 size（如 1024×1024 (1:1)），视频模式显示 resolution/ratio，不再混用

### Deprecated
- **Wan 2.6 全系列全局隐藏** — wan2.6-i2v、wan2.6-i2v-flash visible_in 清空 + wan2.6-r2v 标记 deprecated，Studio 和 Playground 统一不再展示
- **Wan 2.5 / 2.2 系列** — 确认全部 deprecated + visible_in=[]

### Fixed
- **Vidu watermark 误标** — catalog 从 true 改为 false（代码中无此参数）
- **收藏状态不同步** — 改为从 store generation 数据驱动（单一数据源），卡片/详情面板自动一致
- **下载打开新标签** — 改为 fetch→blob→createObjectURL 强制浏览器下载
- **筛选不显示失败任务** — 改为按 mode 判断分类，不依赖 outputs

---

## [1.1.0] - 2026-06-05

### Added
- **MuleRun/MuleRouter provider** — 通过 MuleRun 平台调用 Seedance 2.0 (T2V/I2V/R2V) 和 GPT-Image-2 (T2I/I2I)，一个账号统一计费
- **MuleRun CLI 双模式** — 支持 CLI subprocess 模式（`mulerun login` 登录）和 HTTP API 模式（`MULEROUTER_API_KEY`），自动检测优先级
- **R2V 模型一等公民** — 独立 `selection_group: r2v`，8 个 R2V 模型跨 6 个 family 直接可见可选，消除旧的 hidden + 推导架构
- **reference_sheet 生成类型** — R2V 角色设定图一次 T2I 生成（含特写 + 三视图），替代旧的 full_body → three_view → headshot 三步流水线
- **GroupedModelGrid 组件** — 模型按 family 分组展示（带 display_name 标题），覆盖 6 个设置/选择组件
- **Family display_name** — Catalog YAML 支持 `display_name` 字段，如 "Wan (通义万相)"、"Seedance (即梦)"
- **t2v selection group** — 为 Seedance T2V 预留独立分组，不污染 I2V 列表
- **MuleRun key 配置 UI** — 全局设置 + 项目环境配置统一，含 3 步获取引导面板
- **MuleRun CLI 登录检测** — 当 CLI 已登录时显示 "✓ MuleRun CLI 已登录，无需手动填写"
- **R2V 模型全局默认设置** — 全局设置页新增 R2V 模型选择区

### Changed
- **错误透传** — 资产生成失败显示 provider 真实错误信息（替代通用 "请检查 API 配置"），toast 支持复制错误详情
- **isVisibleModel 过滤 deprecated** — deprecated 状态的模型不再出现在 UI 下拉列表

### Deprecated
- **wan2.6 全系列** — wan2.6-t2i、wan2.6-image、wan2.6-i2v、wan2.6-i2v-flash 等全部标记 deprecated，UI 不再显示

### Fixed
- **GPT-Image-2 size 兼容** — 自动转换 DashScope 格式 (1024*768) 为 GPT-Image-2 合法尺寸 (1536x1024)
- **GPT-Image-2 edit 参数** — `--images` (复数) 替代 `--image`
- **MuleRun CLI JSON 格式** — 兼容 string URL 数组和 object 数组两种返回格式
- **Pipeline 死代码** — 删除重复的 `create_asset_video_task` 定义，R2V-aware 版本生效
- **图片生成路由** — `AssetGenerator` 按 model_name 前缀路由到 MuleRouter adapter
- **R2V auto-switch 防护** — 直选 R2V 模型时跳过 I2V→R2V 自动切换
- **wan2.7-i2v 去掉残留 r2v capability** — 避免路由歧义
- **HappyHorse R2V 补 inputs.reference_images** — UI 正确显示参考图限制
- **MuleRouter submit 加 retry** — 提交任务与轮询/下载一致使用指数退避重试
