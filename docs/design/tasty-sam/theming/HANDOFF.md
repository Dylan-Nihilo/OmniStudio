# HANDOFF · LumenX Studio 多主题系统 + 模态补稿

> **本文件的唯一目的**：让任何接手者（包括上下文被压缩后的我、或项目原 Agent）只读这一份就能安全各司其职、零返工、零功能删减。
> 设计方：**Tasty Sam**（前端设计/主题/Logo/页面规格）。落地方建议：**项目原 Agent**（真实 Next.js 接入 + 后端数据流）。
> 所有产出位于 `docs/design/tasty-sam/theming/`，**纯静态高保真原型，零侵入现有代码**。

---

## 0. TL;DR（30 秒读完）

- 决策：把「Warm Bridge vs Full Atelier 二选一」升级为**用户可选 5 预设主题**（3 暗 + 2 亮），`atelier-dark`（Full Atelier）为默认；换主题时 **Logo 一并联动**。
- 主题落地成本极低：现有前端颜色 100% 走 CSS 变量，只需「globals.css 加 token block + store 枚举升级 + tailwind 主色变量化」，**组件零改动**（除 Logo 组件）。
- Logo 已重制：三个变体**同形**（电路枫叶），均由暗色 Logo 重着色、**透明底**，已弃用旧莲花图 `LumenX_亮色.png`。
- 9 个核心文件 + 3 个模态补稿已交付；原 3 项「需沟通」已全部补稿，**全程未删减任何功能**。
- 落地分工见 §4；防阉割契约见 §5；逐文件清单见 §2。

---

## 1. 五个预设主题（不可变约定）

| presetId | 名称 | 明暗 | 底色 | 主色 | 强调/选中 | Logo 变体 | 默认 |
|----------|------|------|------|------|-----------|-----------|------|
| `atelier-dark`  | Full Atelier | 暗 | 暖石墨 `#0c0b0e` | teal `#34d8c4` | amber `#ffa94d` halation | `logo-dark.png` + CSS filter teal 化 | ★默认 |
| `bridge-dark`   | Warm Bridge  | 暗 | 暖中性 `#0a0a0d` | brand 蓝 `#646cff` | amber 仅选中 | `logo-dark.png`（原蓝） | |
| `brand-dark`    | Brand-True   | 暗 | 冷黑 `#050508` | brand 蓝 `#646cff` | hot pink `#ff0080` | `logo-dark.png`（原蓝） | |
| `atelier-light` | 暖亮 Atelier | 亮 | 暖陶白 `#f6f1e9` | teal deep `#1d9c8d` | amber deep `#e8852b` | `logo-light-teal.png` | |
| `brand-light`   | 品牌亮色     | 亮 | 冷白 `#f8f9fa` | brand 蓝 `#646cff` | — | `logo-light.png` | |

> 演示稿用 `:root[data-theme="<id>"]`；落地映射到 `html.<id>`（二者等价，见 `THEME-TOKENS.md §4`）。

---

## 2. 交付物清单（`docs/design/tasty-sam/theming/`）

### 主题地基
| 文件 | 作用 | 落地相关 |
|------|------|----------|
| `tokens.css` | ★可落地：5 个 `[data-theme]` block，命名 100% 对齐现有 `globals.css`；seed→semantic→component 三层 | 并入 globals.css |
| `theme-switch-demo.html` | 顶部扁平预设列表 + 同一工作台 DOM 实时换 5 主题 + Logo 联动 | 验证用 |
| `logo-adaptation.html` | Logo × 5 主题联动矩阵 + 落地规则 | 接 LumenXBranding |
| `THEME-TOKENS.md` | 三层架构说明 + 变量清单 + data-theme↔html.class 等价 | 落地依据 |
| `README.md` | 五主题导览 + 四步接线说明 | 落地依据 |

### 核心三页定稿（每页右上角内置主题切换器）
| 文件 | 映射后端契约 |
|------|--------------|
| `storyboard-r2v.html`（旗舰，全功能）| `StoryboardFrame`/`VideoTask`，景别7/机位8/运镜14/状态4/tab2 |
| `workspace.html` | `Series`(workflow_mode/content_mode/default_generation_mode)/`Script`(episode) |
| `library.html` | `AssetUnit`/`ImageVariant`/`VideoVariant`(selected_id) |

### 模态补稿（本轮新增，原「需沟通」3 项）
| 文件 | 还原组件 | 展示态 |
|------|----------|--------|
| `modal-compare.html` | `shot-panel/CompareModal.tsx` | 2×2 网格 synced+all-muted |
| `modal-dialogue-workbench.html` | `DialogueAudioRow.tsx`（行 + 内嵌模态，**无独立 Modal 文件**）| Step3 预览版 |
| `modal-generate-promptexpand.html` | `StoryboardGenerateDialog.tsx` + `PromptExpandModal.tsx` | 全通过+覆盖警告 / 单语编辑 |

> 每个模态补稿底部均带「**差异/风险表**」——落地实现方必读，已逐项标注「现状 vs 补稿处理 vs 风险等级」。

### 防阉割
| 文件 | 作用 |
|------|------|
| `FUNCTION-COVERAGE.md` | 功能点→后端字段→定稿落点→状态（✅/🟡/🔴）全量映射 |
| `HANDOFF.md`（本文件）| 协作契约 |

### 资产 `assets/`
| 文件 | 说明 |
|------|------|
| `logo-dark.png` | 暗主题：白描边 + 蓝棱形核心，透明底 |
| `logo-light-teal.png` | `atelier-light`：深墨描边 + teal 核心，透明底 |
| `logo-light.png` | `brand-light`：深墨描边 + 蓝核心，透明底 |
| `char-detective.png` / `scene-skyline.png` / `shot-0{1,2,3,5}.png` | 真实 noir 媒体（复用）|

---

## 3. Logo 规范（本轮重点修正）

**问题**：上一版亮色 Logo 沿用了旧的莲花/原子造型（紫蓝渐变 + 白底），与暗色电路枫叶 Logo **不是一组**，且白底与界面不协调。

**修正**：三个变体全部**基于暗色 Logo 同形重着色**（保形状、换色、透明底）：
- `logo-dark.png`（原有）：浅色描边 + 蓝 `#646cff` 棱形核心。
- `logo-light-teal.png`（新）：深墨 `#1e1b26` 描边 + teal `#1d9c8d` 核心 → `atelier-light`。
- `logo-light.png`（重制覆盖）：深墨 `#1e1b26` 描边 + 蓝 `#4a54e6` 核心 → `brand-light`。

**落地接线**（`LumenXBranding.tsx` 必改，详见 `logo-adaptation.html`）：
1. 写死的 `src="/LumenX-cybr.png"` → 按 presetId 切：暗 → `/LumenX-cybr.png`；`atelier-light` → teal PNG；`brand-light` → 蓝 PNG。
2. `atelier-dark` 加内联 `filter: hue-rotate(-64deg) saturate(1.35) brightness(1.08)` 把蓝着成 teal；其余 `none`。
3. wordmark 文字色：`text-white` → `var(--color-text-primary)`；"X" `#646cff` → `var(--color-primary)`；slogan/Studio → secondary/muted token。**（修复亮色下白底白字不可读）**
4. 真实项目落地时，把这三张 PNG（或对应 SVG）放入 `frontend/public/`，命名与 src map 对齐。

> **侧栏图标澄清（防误解）**：真实 `PipelineSidebar.tsx` 的步骤图标**早已是 lucide-react 线性图标**（`BookOpen / Palette / Users / Clapperboard / Film`，step 定义在 `ProjectClient.tsx` 的 `UNIFIED_STEPS`），**不是 emoji**。本批 HTML 原型里出现的 emoji→手绘 SVG，纯属「静态 HTML 无法 import lucide」的占位，仅为视觉对齐。**落地时图标保持现有 lucide 不动，无需任何接线。**

---

## 4. 落地分工（谁做什么）

### Tasty Sam（设计方）已完成 ✅
- 主题 token 系统（seed→semantic→component，5 主题派生）。
- Logo 三变体重制（同形、透明底）+ 联动规则。
- 核心三页 + 三模态视觉/组件规格定稿（含状态全覆盖 + 风险标注）。
- 功能承载 checklist + 本 HANDOFF。

### 项目原 Agent（落地方）待执行 ⬜（建议，更懂项目）
按 `README.md §3` 四步，**增量、每步可编译**：
1. **store 枚举升级** `settingsStore.ts`：`Theme` → `ThemePreset`（5 值），默认 `'atelier-dark'`；persist `migrate` 旧值 `'dark'→'brand-dark'`、`'light'→'brand-light'`。
2. **globals.css 并入** `tokens.css` 5 block：选择器 `:root[data-theme="<id>"]` → `html.<id>`，默认 `:root` 复用 `atelier-dark`；新增变量（`--color-primary`/`--halation`/`--font-display` 等）一并加入。
3. **tailwind.config.ts 主色变量化**（唯一须动配置）：`primary/secondary/accent` 硬编码 hex → `var(--color-primary)` 等。**这是主色能随主题翻转的关键。**
4. **Providers + layout + Logo**：`Providers.tsx` class 列表扩 5 值；`layout.tsx` 防闪烁内联脚本白名单扩 5 + 默认 `atelier-dark`；`LumenXBranding.tsx` 按 §3 改造。
5. **设置页**：加一排扁平主题预设卡（5 张，参考三页右上角 `.themepick` 视觉）。
6. **模态接线**：三个模态本就存在于代码，落地只需「换肤（颜色走 token）」+ 对照各模态风险表保持交互逻辑不变，**不要重构布局**。

### 协作验收
双方对照 `FUNCTION-COVERAGE.md` 逐项核验：✅ 视觉已含、🟡 接线即可、🔴 无（已清零）。确保「视觉不阉割功能、数据/交互全接上」。

---

## 5. 防阉割契约（最高优先级，来自用户明确要求）

> 用户原话精神：**任何与现有功能有出入、或布局改动较大的，必须专门说明并由用户知情；交互逻辑变了会带来风险，绝不自行删减功能。**

落地与后续设计**必须**遵守：
1. **不得为迁就设计删减任何已有功能**。放不下 → 在 `FUNCTION-COVERAGE.md` 标 🔴 并主动提出，由用户拍板。
2. **不得擅自改交互逻辑**。三个模态的「差异/风险表」已标出每处「现状 vs 处理 vs 风险」，落地以**现状代码逻辑为准**，视觉换肤优先。
3. **关键纠偏**（曾被误判，落地切勿照旧假设）：
   - `CompareModal`：**纯视频对比**（无图像对比，图像走 Lightbox）、硬上限 4、★ 只读（切换在 CandidateThumb）、标题「Compare N candidates」**英文硬编码**。
   - `StoryboardGenerateDialog`：**不是批量参数选择器**，无 范围/数量/画风/模型 控件；只做「前置检查 + 覆盖警告 + 确认」，确认即关闭、无内置 loading（进度走全局 toast + GenerationBanner）。
   - `PromptExpandModal`：**单语**（一个 textarea），双语 CN/EN + Copy/Apply + 再优化 是**同级 PolishPanel** 的能力，勿混淆。
   - `DialogueAudioRow`（**配音工作台无独立文件**，行内 + 内嵌模态都在 `DialogueAudioRow.tsx`）：Step3 受 `canDub` 门控（audio+video+taskId+回调全有才显示）；视频源三态优先级 `preview > dubbed > video`；多处中文硬编码与 i18n 键混用。
4. **i18n（落地目标，务必照此实现）**：本批补稿里的可见文案仅为**设计稿视觉保真**而内联原文，**不代表落地文案策略**。正式实现 MUST 走 i18n 键（next-intl），所有面向用户的文案从 messages 取值。现有组件中残留的硬编码中文/英文（如配音工作台标题、「已覆盖/预览中/试听TTS」、`Compare N candidates` 等）属于**待修复缺陷**，落地时应抽取为 i18n 键并补齐 CN/EN，而非照搬保留。

---

## 6. 验证清单（落地后自检）

- [ ] 5 主题切换：底色/主色/强调/字体/氛围/Logo 全部随之切，`atelier-dark` 默认。
- [ ] 改某主题 seed 主色一处，整主题随之变（三层派生自洽）。
- [ ] Logo 联动：暗 teal filter / 暗蓝原色 / 亮色深描边，无白底白字、无可见背景框。
- [ ] 三页 + 三模态功能逐项可见可达；状态覆盖 pending/processing/completed/failed/starred + hover/focus/disabled/empty/loading。
- [ ] 字段映射真实：景别 7、机位 8、运镜 14、tab 2、状态 4，与 `models.py` 一致。
- [ ] 响应式 1440/1024/768 降级；亮色对比度 ≥4.5:1；reduced-motion 生效。
- [ ] 零侵入校验：`git status` 仅见 `docs/design/tasty-sam/theming/**`（设计阶段）；落地阶段改动限 §4 所列文件。

---

## 7. 关键参考文件（只读，保一致性）

- 主题基建：`frontend/src/store/settingsStore.ts`、`frontend/src/app/globals.css`、`frontend/src/components/Providers.tsx`、`frontend/src/app/layout.tsx`、`frontend/tailwind.config.ts`
- Logo：`frontend/src/components/layout/LumenXBranding.tsx`、`frontend/public/{LumenX-cybr.png,LumenX-cybr-transparent.png}`
- 侧栏/步骤：`frontend/src/components/layout/PipelineSidebar.tsx`（lucide 图标）、`frontend/src/components/project/ProjectClient.tsx`（`UNIFIED_STEPS`/`LEGACY_STEPS` 定义）
- 数据/接线：`frontend/src/lib/api.ts`（全部端点）、`frontend/src/store/{projectStore,settingsStore,toastStore}.ts`、`frontend/src/components/modules/StoryboardR2V.tsx`（顶层 orchestrator，所有 api.* 汇聚处）
- 模态源码：`frontend/src/components/modules/storyboard-r2v/shot-panel/CompareModal.tsx`、`.../DialogueAudioRow.tsx`、`.../StoryboardGenerateDialog.tsx`、`.../PromptExpandModal.tsx`、`.../PolishPanel.tsx`
- 数据契约：`src/apps/comic_gen/models.py`、`config/model_catalog/`

---

## 8. 组件清单（新建 / 替换 / 不动）— 后端对接视角

> **前提（极重要）**：本批主题化是**零侵入换肤**，**不新增、不替换任何业务组件，也不改任何接口/数据流**。下表的「替换」仅指「换肤改动（颜色/字体走 token）」，逻辑与 props 不变。后端 agent 的接线点因此**全部落在现有组件**上，无新组件引入。
>
> 架构关键：`storyboard-r2v/**` 子组件（ShotCard / ShotPanel / 各 Section / 各模态）**几乎都是纯展示组件，通过 callback props 委托**；**所有 `api.*` 调用汇聚在顶层 `StoryboardR2V.tsx`**。后端接线主战场 = `StoryboardR2V.tsx`。

| 组件 | 落地处置 | 改动性质 | 后端接线 |
|------|----------|----------|----------|
| `StoryboardR2V.tsx` | 不动逻辑 | 仅换肤（容器色/间距走 token）| **所有 api.* 在此**（见 §10）|
| `ShotCard.tsx` / `ShotPanel.tsx` / `ParamsSection.tsx` / `CandidatesSection.tsx` / `CandidateThumb.tsx` / `T2ISubsection.tsx` | 不动逻辑 | 仅换肤 | 无直接调用，全 callback 委托给父 |
| `CompareModal.tsx` | 不动逻辑 | 仅换肤 | 无后端调用（纯客户端视频对比）|
| `DialogueAudioRow.tsx` | 不动逻辑 | 仅换肤 + 待 i18n 化 | `api.generateLineAudio` + dub 回调 |
| `PolishPanel.tsx` | 不动逻辑 | 仅换肤 | `api.polishR2VPrompt` / `api.polishVideoPrompt` |
| `PreviousEpisodeFramesRail.tsx` | 不动逻辑 | 仅换肤 | `api.getPreviousEpisodeSummary` |
| `GenerationBanner.tsx` / `StoryboardGenerateDialog.tsx` / `PromptExpandModal.tsx` / `AssetDrawer.tsx` / `AssetChipBar.tsx` / `TaskQueuePanel.tsx` / `TaskQueueButton.tsx` | 不动逻辑 | 仅换肤 | 无后端调用，全 callback 委托 |
| `LumenXBranding.tsx` | **改造** | Logo src 按 preset 切 + wordmark 文字 token 化（§3）| 无 |
| `PipelineSidebar.tsx` | **不动** | 图标已是 lucide，**零改动** | 无 |
| `settingsStore.ts` | **替换枚举** | `Theme`→`ThemePreset`(5 值) + persist migrate | 无（纯前端态）|
| `globals.css` / `tailwind.config.ts` / `Providers.tsx` / `layout.tsx` | **改造** | token block / 主色变量化 / class 列表 / 防闪烁脚本（§4）| 无 |

> **新建组件**：仅「设置页 5 张主题预设卡」一处可视为新增 UI（§4 步骤 5），不涉及后端。

---

## 9. 组件 → 数据依赖（store / API 读取）

> store 现状：`projectStore`（persist key `project-storage`）持有 `currentProject`（含 frames / video_tasks / model_settings / prompt_config 等）；`settingsStore`（key `lumenx-settings`）持 locale/theme；`toastStore`（不持久）。**无独立 task-queue store**——视频任务态就在 `currentProject.video_tasks` + `generatingTasks[]` + `runningOps` 上。

| 组件 | 读 store | 读取字段 | 数据来源 API |
|------|----------|----------|--------------|
| `StoryboardR2V.tsx` | `useProjectStore` | `currentProject`（全量）、`updateProject` | `api.getProject`（轮询刷新）|
| `ShotCard.tsx` | `useProjectStore` | `currentProject?.id`（仅传给 PolishPanel 当 scriptId）| 经父 props 拿 shot 数据 |
| 各 Section / 模态 | **不读 store** | 全部经 props 注入 | 经父 callback |
| 主题切换器 / 设置页 | `useSettingsStore` | `theme` / `setTheme`、`locale` | 无 |
| 全局反馈 | `useToastStore` | `toast.*` | 无 |

**ShotCard 渲染所需字段**（均来自 `currentProject.frames[i]`，后端 `StoryboardFrame`）：`image_prompt`/`video_prompt`、`workbench_tab_mode`、`workbench_generate_count`、`t2i_image_urls`/`t2i_selected_index`、`duration`/`shot_size`/`camera_angle`/`camera_movement_structured`/`transition_hint`、`character_ids`、`is_video_pinned`/`selected_video_id`、`dialogue_structured`、关联 `video_tasks`（按 frame 归组）。

---

## 10. 交互 → 后端调用（action → endpoint）

> 全部基于真实 `frontend/src/lib/api.ts`（base `:17177`）。下表即后端 agent 的「按钮→接口」对接图。除特别注明外，调用方均为 `StoryboardR2V.tsx`。

### 10.1 分镜 CRUD（`crudApi`）
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| ＋添加分镜 | `crudApi.createFrame` | POST `/projects/{id}/frames` |
| 删除分镜 | `crudApi.deleteFrame` | DELETE `/projects/{id}/frames/{frameId}` |
| 上/下移 | `crudApi.reorderFrames` | PUT `/projects/{id}/frames/reorder` |
| 复制分镜 | `crudApi.copyFrame` | POST `/projects/{id}/frames/copy` |

### 10.2 生成 / 渲染
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| 从剧本智能分镜（GenerateDialog 确认）| `api.analyzeToStoryboard` | POST `/projects/{id}/storyboard/analyze` |
| 全部精修（SSE 流）| `api.refineBatchFrames` | POST `/projects/{id}/storyboard/refine_batch` |
| 单帧精修 | `api.refineSingleFrame` | POST `/projects/{id}/frames/{frameId}/refine` |
| T2I 首帧生成 | `api.renderFrame` | POST `/projects/{id}/storyboard/render` |
| T2I 上传首帧 | `api.uploadT2IFrame` | POST(multipart) `/projects/{id}/frames/{frameId}/upload_t2i` |
| 生成视频 ×N（I2V & R2V）| `api.createVideoTask` | POST `/projects/{id}/video_tasks` |
| 合成对白语音（Banner CTA / 批量）| `api.generateDialogueAudioBatch` | POST `/projects/{id}/dialogue_audio/batch` |

### 10.3 候选 / take 管理
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| ★星标 / 设 label | `api.annotateVideoTask` | PATCH `/projects/{id}/video_tasks/{taskId}/annotate` |
| 设为当前 take（Pin）| `api.selectVideo` | POST `/projects/{id}/frames/{frameId}/select_video` |
| 取消 Pin | `api.unpinVideo` | POST `/projects/{id}/frames/{frameId}/unpin_video` |
| 完成后自动选最新 | `api.autoSelectLatestVideo` | POST `/projects/{id}/frames/{frameId}/auto_select_latest_video` |
| 取消在途任务 | `api.cancelVideoTask` | POST `/projects/{id}/video_tasks/{taskId}/cancel` |

### 10.4 Prompt 润色（PolishPanel）
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| R2V 模式润色 | `api.polishR2VPrompt` | POST `/video/polish_r2v_prompt` |
| I2V 模式润色 | `api.polishVideoPrompt` | POST `/video/polish_prompt` |

### 10.5 配音 / 配音覆盖（DialogueAudioRow）
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| 生成单行 TTS | `api.generateLineAudio` | POST `/projects/{id}/frames/{frameId}/audio` |
| 预览 dub 覆盖 | `api.previewDub` | POST `/projects/{id}/frames/{frameId}/dub/preview` |
| 应用 dub | `api.applyDub` | POST `/projects/{id}/frames/{frameId}/dub/apply` |
| 撤销 dub | `api.revertDub` | DELETE `/projects/{id}/frames/{frameId}/dub` |

### 10.6 持久化（防抖写回，静默）
| 触发 | 调用 | HTTP / 端点 | 防抖 |
|------|------|-------------|------|
| T2I 历史 / 选中 / 计数 / tab 切换 | `api.updateFrameWorkbench` | PATCH `/projects/{id}/frames/{frameId}/workbench` | 1000ms |
| prompt 文本编辑 | `api.updateFrame` | POST `/projects/{id}/frames/update` | 800ms |
| 结构字段（时长/景别/机位…）| `api.updateFrame` | POST `/projects/{id}/frames/update` | 800ms |

### 10.7 上一集参考
| 操作 | 调用 | HTTP / 端点 |
|------|------|-------------|
| 加载上一集末帧 | `api.getPreviousEpisodeSummary` | GET `/projects/{id}/previous_episode` |

### 10.8 轮询架构（后端需知道前端怎么刷新状态）
| 轮询 | 拥有者 | 周期 | 调用 | 触发条件 |
|------|--------|------|------|----------|
| 项目级刷新 | `StoryboardR2V.tsx` | 5000ms | `api.getProject` | 有 `video_tasks` 处于 pending/processing，或 shot 本地 taskId 尚未回写 |
| 单 shot 任务态 | `StoryboardR2V.tsx` | 5000ms | `api.getTaskStatus(taskId)` | 有 shot 的 video/T2I 处于 processing/pending；视频完成后追加 `autoSelectLatestVideo` |

> **后端契约要点**：`createVideoTask` / `renderFrame` 返回 taskId 后，前端靠 5s 轮询 `getTaskStatus` 拿进度，靠 `getProject` 合并最终结果。所以这些任务端点应**立即返回 taskId（异步）**，状态查询走 `/tasks/{taskId}`，与现有后端一致即可，**勿改成同步阻塞**。

---

## 11. 接口 / 逻辑冻结清单（"不要动的部分"）

> 换肤落地与后续协作，以下**保持原样，禁止顺手改**：

1. **全部 API 端点签名不变**：§10 所列 `api.*` / `crudApi.*` 的方法名、HTTP 动词、路径、入参/出参一律不动。换肤不碰 `api.ts`。
2. **数据流方向不变**：`StoryboardR2V.tsx` 仍是唯一 orchestrator；子组件保持「纯展示 + callback 委托」，**不要把 api 调用下沉进子组件**。
3. **轮询/防抖时序不变**：项目轮询 5s、任务轮询 5s、workbench 防抖 1000ms、prompt/字段防抖 800ms、提交锁 500ms、caption 轮播 3000ms、`beforeunload` flush + 卸载 drain。这些是数据一致性保障，换肤勿动。
4. **localStorage 键不变**：`storyboard-r2v-model` / `storyboard-r2v-r2v-model` / `storyboard-r2v-expanded-${projectId}`；store persist 键 `project-storage`、`lumenx-settings`（settingsStore 仅升级枚举值 + migrate，键名不变）。
5. **buildAssembledPrompt 规则不变**：剥离 `[characterN:name]` tag（单独走 `reference_image_urls`）；后缀顺序 **运镜描述 → 景别+机位 → 转场**，以中文逗号 `，` 连接；**时长不入文本**（走 `duration` 参数）；base 末尾已有标点则不再补逗号。
6. **关键交互语义不变**（详见 §5.3）：CompareModal 纯视频/上限 4/★ 只读；StoryboardGenerateDialog 仅确认无参数无 loading；PromptExpandModal 单语；DialogueAudioRow 的 `canDub` 门控 + 视频源三态 `preview>dubbed>video`。
7. **任务端点异步语义不变**：生成类端点返回 taskId 即走，状态查询走 `/tasks/{taskId}` + `getProject` 合并；勿改同步阻塞。

> 凡需突破以上任一条（接口签名/数据流/时序/prompt 规则变更），**必须先在本文件登记并由用户拍板**，对齐 §5 防阉割契约精神。

---

_最后更新：本轮（Logo 重制 + 三模态补稿 + 防阉割契约固化 + **后端对接四表 §8-§11** + lucide 图标/DialogueAudioRow 命名纠偏）。如本文件与代码/其他文档冲突，以「不删减功能、视觉换肤优先、布局不重构、接口/数据流冻结」为最高准则。_
