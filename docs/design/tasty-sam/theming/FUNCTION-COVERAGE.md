# FUNCTION-COVERAGE — 功能承载 checklist（防阉割）

> 目的：把现有 Storyboard R2V 工作台的**全部功能点**逐项映射到本轮主题化定稿，确保「为设计妥协而阉割功能」不会发生。
> 状态定义：✅ 已承载（定稿已含视觉落点）｜🟡 待定（设计已留位，落地需接线）｜🔴 需沟通（当前定稿放不下/有取舍，必须与你确认，绝不自行删减）。
>
> 基线来源：`frontend/src/components/modules/StoryboardR2V.tsx` + `storyboard-r2v/**`、后端 `src/apps/comic_gen/models.py`。

---

## A. 页面 chrome / 工具栏

| 功能点 | 现有组件 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| StepHeader 面包屑 + 标题 | StepHeader | storyboard-r2v.html `.stephead` | ✅ |
| Art Direction pill（点击跳转 Art 步骤）| StepHeader trailing | `.pill 画风` | ✅ |
| 当前模型名标签 | StepHeader trailing | `.pill 模型` | ✅ |
| TaskQueueButton + in-flight 计数脉冲 | TaskQueueButton | `.qbtn .ct`（pulse 动画）| ✅ |
| shot count + N in flight 徽章 | toolbar | `.count .fl` | ✅ |
| ＋添加分镜 | toolbar | `.toolbar` | ✅ |
| 智能分镜 / 重新生成（图标切换）| toolbar | `.btn 重新生成` | ✅ |
| ▾▾全部展开 / ▴▴全部折叠（>1 shot 时）| toolbar | `.toolbar` | ✅ |
| 空态：标题/正文 + 智能分镜 + 手动添加 | empty state | workspace 空态三卡 + 文档说明 | 🟡 |
| StoryboardGenerateDialog（前置检查+覆盖警告+确认弹窗）| 模态 | `modal-generate-promptexpand.html` | ✅ 已补稿 |

## B. GenerationBanner（5 态）

| 功能点 | 定稿落点 | 状态 |
|--------|----------|------|
| idle / phase1 / phase2 / dialogue / summary 五态 | `.banner`（展示 summary 态）| 🟡 仅画 summary，其余文档登记 |
| phase1 轮播文案（3s 切换）| 文档登记 | 🟡 |
| summary：帧数 + 待生成对白 + 缺语音绑定(amber) + 🎙CTA | `.banner` 完整呈现 | ✅ |
| 🎙 合成对白语音 CTA（dialogueReady>0）| `.banner .cta` | ✅ |

## C. 跨剧集参考

| 功能点 | 定稿落点 | 状态 |
|--------|----------|------|
| PreviousEpisodeFramesRail 折叠带（有上一集才显示）| `.prevrail` | ✅ |
| 横向滚动帧缩略 + label + 动作描述 | 展开态文档登记 | 🟡 |

## D. ShotCard

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| Tab 切换 t2i_i2v ↔ direct_r2v | `workbench_tab_mode` | `.tabs` | ✅ |
| Cast 头像（≤3 + 溢出，prompt regex 派生，点击跳 Cast）| `character_ids` | `.cast` | ✅ |
| Pinned chip + hover 取消 | `is_video_pinned` | `.pinchip .unpin` | ✅ |
| Hero 预览多态：empty/processing/completed/failed | `status` | shot①②③ 分别呈现 | ✅ |
| PendingTaskAffordance（>60s 卡住 + 取消）| — | `.hero .ov` + 队列取消 | 🟡 |
| Prompt textarea + ⌘E 展开 + ⛶ Maximize | `image_prompt`/`video_prompt` | `.ta` + `.exp` | ✅ |
| PromptExpandModal 全屏编辑（单语，⌘E 开/存）| 模态 | `modal-generate-promptexpand.html` | ✅ 已补稿 |
| AssetChipBar（角色蓝/场景绿/道具橙，插入 `[type:name]`）| — | `.chipbar` | ✅ |
| FieldTagChips：时长/景别/机位/运镜/转场（5 色）| `duration`/`shot_size`/`camera_angle`/`camera_movement_structured`/`transition_hint` | `.fields .fchip` | ✅ |
| AddFieldButton（+ 未设字段下拉）| — | `.addf` | ✅ |
| 景别 7 档枚举 | `ShotSizeEnum` | chip 值（近景/中景…）| ✅ |
| 机位 8 档枚举 | `CameraAngleEnum` | chip 值（平视…）| ✅ |
| 运镜 14 值 + 主/副/速度/描述 | `CameraMovementData` | chip「推镜·慢」+ 文档登记结构 | 🟡 |
| 转场（free-form hint，非枚举）| `transition_hint` | chip「硬切」| ✅ |
| 动作条 @ ↑ ↓ 复制 删除 单帧精修 | move/duplicate/delete/refine | `.acts` 6 按钮 | ✅ |
| 计数选择 ×1/2/4/6 | `workbench_generate_count` | `.cntsel` | ✅ |
| Generate ×N + disabled-with-reason | `canGenerate` | `.gen` + shot③ disabled | ✅ |
| 展开/折叠 disclosure | `expandedShots` | `.disc` | ✅ |
| assembled_prompt 预览（Code2）| `assembled_prompt` | 文档登记（buildAssembledPrompt 规则）| 🟡 |
| 对白只读展示 | `dialogue_structured.line` | diarow 文案 | ✅ |
| Hover 聚光边框 | — | 文档登记（CSS 变量 mousemove）| 🟡 |

## E. ShotPanel · ParamsSection

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| SectionShell 折叠 + in-flight 徽章 | — | `.sect-h .badge` | ✅ |
| 模型选择 pills（R2V 模型列表）| `ModelSettings.r2v_model` | `.prow 模型` | ✅ |
| DurationControl 三态（fixed/buttons/slider）| `VideoTask.duration` | `.prow 时长`（buttons）| 🟡 |
| 分辨率 / 比例 pills | `resolution`/`ratio` | `.prow 分辨率/比例` | ✅ |
| 高级折叠：负向词/种子(+骰子+清)/CFG/运动幅度/sound/vidu_audio/prompt_extend/watermark/shot_type | 对应 VideoTask 字段 | `.advfold`（折叠条 + 文档）| 🟡 |
| 负向词跨模型保留 | `negative_prompt` | 文档登记 | 🟡 |
| 内联错误（如 happyhorse 需参考图）| — | `.err` | ✅ |

## F. ShotPanel · T2ISubsection

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| Hero 态（生成+上传+拖拽+占位）| — | shot③ hero | ✅ |
| Compact 条（×N 缩略 + Reroll + +/上传菜单）| `t2i_image_urls` | `.t2istrip` | ✅ |
| 缩略 96×54 选中边框 + hover 删除 + storyboard pin 徽章 | `t2i_selected_index` | `.t2ithumb` | ✅ |
| FIFO 上限 10 | `T2I_HISTORY_LIMIT` | `.sect-h sub「3/10·FIFO」` | ✅ |
| 上传校验 8MB jpeg/png/webp | — | `.t2icount` 文案 | ✅ |
| processing 自动展开 | — | 文档登记 | 🟡 |

## G. ShotPanel · CandidatesSection + CandidateThumb

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| 批次分组（15s gap + model/prompt/negative 指纹）| `BATCH_GAP_MS` | `.batch` | ✅ |
| 过滤 chips：全部/★星标/本模型 | — | `.candfilter` | ✅ |
| 排序：时间/模型 | — | `.srt` | ✅ |
| Compare callout（≥2 选中提升）| — | `.cmpcallout` | ✅ |
| 空态三步脚手架 | — | 文档登记 | 🟡 |
| BatchBlock 折叠 + 状态 pips + 复用参数 | — | `.batch-h .pips/.reuse` | ✅ |
| CandidateThumb：★星标 + 可编辑 label(≤20) + Pin | `is_starred`/`label`/`selected_video_id` | `.cand` 多态 | ✅ |
| Shift+Click 对比多选 + 角标 | — | `.cand.cmp .cmpck` | ✅ |
| 多态：processing(取消)/failed(重试)/completed/active/compare-selected | `status` | `.cand` 4 态 | ✅ |
| dubbed URL 自动替换 | `dubbed_video_url` | 文档登记 | 🟡 |
| 复用参数（model/duration/res/negative，不含 count）| — | `.reuse` + 文档 | ✅ |

## H. CompareModal

| 功能点 | 定稿落点 | 状态 |
|--------|----------|------|
| 2–4 视频 1×2/2×2 网格（实为纯视频，硬上限 4）| `modal-compare.html` | ✅ 已补稿 |
| Synced/Independent 切换 + 50ms 跟随 | `modal-compare.html` | ✅ |
| Solo 循环 + S 键 + Space 播放 + ESC | `modal-compare.html` | ✅ |
| Focus trap + 焦点恢复 | `modal-compare.html` 文档登记 | 🟡 |

> **✅ 已补稿**：`modal-compare.html` 还原 CompareModal 全貌（2×2 网格 + 同步/独立 + Solo + 快捷键图例 + no-video 降级格），内置主题切换 + 差异/风险表。**纠偏：此模态纯视频对比、硬上限 4、★ 只读、标题英文硬编码——详见该页风险表。**

## I. TaskQueuePanel

| 功能点 | 定稿落点 | 状态 |
|--------|----------|------|
| 三响应式布局（≥xl 推列 / md-lg overlay / <md 全屏）| `.queue`（画推列）+ 文档登记另两档 | 🟡 |
| Active/Done/Failed tabs + 计数 | `.q-tabs` | ✅ |
| Compact 行（状态点+label+缩略+裁剪prompt+meta）| `.qrow`（运行中）| ✅ |
| Expanded 行（输入+输出 120×68 + 全 prompt + 全参数 + 错误 + provider IDs 复制 + 复制诊断 + 重试）| `.qrow.exp` | ✅ |
| Failed 行预展开 | `.qrow.exp` | ✅ |
| Jump-to-shot 箭头 | `.qrow .jmp` | ✅ |
| Cancel（仅 in-flight）| `.qacts 取消` | ✅ |
| 多 provider task id 分别复制（百炼/可灵/Vidu/PixVerse/本地）| `.pids`（画 2 项 + 文档全列）| 🟡 |

## J. PolishPanel（双语润色）

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| 触发 → loading skeleton → success 双语 + BorderGlow | `image_prompt_cn`/`image_prompt_en` | `.polish.glow` | ✅ |
| 每列 复制(✓1.5s) + 应用 | — | `.bcol .op` | ✅ |
| 反馈输入 + 再润色（Enter，prev_cn 锚点）| — | `.feedback` | ✅ |
| Discard ✕ | — | `.polish .x` | ✅ |
| 硬错误 banner + 重试 + 复制原文 | — | 文档登记 | 🟡 |
| model_echo 软警告（amber，保留双语）| — | shot③ `.warn` | ✅ |
| R2V/I2V 路由（polishR2VPrompt / polishVideoPrompt）| `PromptConfig.r2v_polish`/`video_polish` | 文档登记 | 🟡 |

## K. DialogueAudioRow（配音工作台，行 + 内嵌模态，无独立 Modal 文件）

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| Row 状态徽章：error/ready/已覆盖/预览中 | `audio_error`/`audio_url`/`dubbed_video_url`/`preview_video_url` | `.diarow .badge`（ready/preview/error 三态）| ✅ |
| 已覆盖（emerald）态 | `dubbed_video_url` | 文档登记（badge 类已备 b-applied）| 🟡 |
| Step1 文本（blur 自动保存）| `dialogue_structured` | `modal-dialogue-workbench.html` | ✅ 已补稿 |
| Step2 8 情绪 chips + 80字指令 + 生成 TTS + 播放 | `dialogue_instructions`/`dialogue_voice_id` | `modal-dialogue-workbench.html` | ✅ |
| Step3 视频 + 标记起始点 + ±50ms + 数字 + slider + 预听/应用/撤销覆盖 | `dub_offset_ms`/`dubbed_video_task_id` | `modal-dialogue-workbench.html` | ✅ |
| stale 追踪（dialogue/voice/instructions 快照）| `dialogue_text_hash` | 文档登记 | 🟡 |

> **✅ 已补稿**：`modal-dialogue-workbench.html` 还原配音工作台三步（文本/情绪生成/覆盖视频），展示 Step3「预览版」态 + 触发行徽章三态，内置主题切换 + 差异/风险表。**纠偏：Step3 受 `canDub` 门控、视频源三态优先级 preview&gt;dubbed&gt;video、多处中文硬编码——详见该页风险表。**

## L. AssetDrawer

| 功能点 | 定稿落点 | 状态 |
|--------|----------|------|
| 右侧 w-80 抽屉 + backdrop 关闭 | 入口 `@` 按钮 + 文档登记 | 🟡 |
| 三分组（角色蓝/场景绿/道具橙）2 列 | library.html 已体现分类视觉 | 🟡 |
| 点击插入 tag + 自动关闭 | 文档登记 | 🟡 |

## M. 工作区 / 资产库（workspace + library）

| 功能点 | 后端字段 | 定稿落点 | 状态 |
|--------|----------|----------|------|
| Series/Project 混排卡 | `Series`/`Script` | workspace `.grid` | ✅ |
| workflow_mode / content_mode / default_generation_mode 标签 | 对应字段 | `.tag` | ✅ |
| episode_number / 帧数 | `episode_number` | `.tag` | ✅ |
| Toolbar 同步/导入/创建下拉 | — | `.toolbar` | ✅ |
| 空态三卡 | — | `.empties` | ✅ |
| 状态徽章 completed/processing/pending | `status` | `.badge` | ✅ |
| 资产库 搜索 + 角色/场景/道具 tabs | — | library `.bar` | ✅ |
| 来源分组折叠（系列共享 / 单集本地）| 容器归属 | `.group` | ✅ |
| series-shared 徽章 | 容器归属 | `.badge SERIES 共享` | ✅ |
| AssetCard 多变体 selected_id | `selected_image_id`/`image_variants` | `.variants .v.sel` | ✅ |
| 角色 persona 分组标签 | `Character.persona` | `.persona` | ✅ |
| 语音绑定 chip（system/clone/design）| `voice_origin`/`voice_id` | `.voicechip` | ✅ |
| VideoVariant 动态参考徽章 | `video_variants` | `.athumb .vid` | 🟡 |
| 资产锁定 | `locked` | `.athumb .lock` | ✅ |

## N. 跨切面隐藏逻辑（落地须保留，纯文档登记）

| 功能点 | 状态 |
|--------|------|
| buildAssembledPrompt：剥离角色 tag + 后缀顺序(运镜→景别+机位→转场)，时长不入文本 | 🟡 文档登记 |
| 每 shot 500ms 提交防抖 | 🟡 |
| 防抖持久化（workbench 1s / prompt 800ms / 结构字段 3s）+ beforeunload flush | 🟡 |
| 任务轮询 5s（队列清空即停）| 🟡 |
| videoConfig localStorage 级联 + 失效 id 清理 | 🟡 |
| expandedShots 按 project id 持久化 | 🟡 |
| handleJumpToShot 强制展开 + params/candidates 打开 | 🟡 |

---

## 汇总 · 原 3 项需沟通（🔴 → ✅ 已全部补稿）

上一轮标记的 3 个「子系统级模态」现已全部补出独立定稿，每页内置主题切换 + 「差异/风险表」：

1. **CompareModal 对比模态** → `modal-compare.html`（2×2 网格 + 同步/独立 + Solo + 快捷键图例 + no-video 降级格）。
2. **配音工作台模态** → `modal-dialogue-workbench.html`（三步：文本 / 情绪生成 / 覆盖视频 offset 微调，展示预览版态 + 触发行三态徽章）。
3. **StoryboardGenerateDialog / PromptExpandModal** → `modal-generate-promptexpand.html`（前置检查+覆盖警告确认弹窗 + 单语全屏 prompt 编辑器）。

> **重要纠偏**（每页风险表已详列）：CompareModal 为纯视频对比、硬上限 4、★ 只读、标题英文硬编码；StoryboardGenerateDialog 不含任何批量参数、确认即关闭无内置 loading；PromptExpandModal 为单语，双语能力在同级 PolishPanel。落地实现方请以各模态风险表为准。

> 仍为 🟡 的条目均为「设计已留位、落地接线即可」（如 focus trap、stale 追踪、AssetDrawer、多 provider id 全列），不涉及功能取舍。**全程零功能删减。**
