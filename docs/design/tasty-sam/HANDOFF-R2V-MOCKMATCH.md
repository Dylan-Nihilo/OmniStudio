# HANDOFF · R2V 工作台前端 → 对齐 mockup（续接）

> 给下一个会话：本会话做了 R2V 重构的**地基 + 增量改动**，但**核心目标（让 R2V 分镜台视觉对齐 mockup）尚未达成**。本文交代目标、已完成、缺口、回退点、验证方法、硬约束、踩过的坑。读完直接续做。

---

## 0. 一句话目标

让 R2V 分镜台的前端（`StoryboardR2V.tsx` + `storyboard-r2v/` 子树）**视觉/布局对齐这份 mock**：

```
docs/design/tasty-sam/storyboard-r2v-unified.html
```

这份 mock 是**自包含**的（内联 Atelier-dark token + Fraunces/Space Grotesk/JetBrains Mono），就是设计 spec。打开看就是目标样子。

**当前状态：不像。** 本会话只做了增量（修 bug + 下拉 + 生成条 + 侧栏状态），没重塑整体布局。下面详述。

---

## 1. 仓库 / 分支 / 回退点（Git 安全网）

- **Worktree**：`/Users/hoshinoren/Documents/code/project/video_gen/gitlab/tron-comic-pilot-atelier-20260611-161001`（这是 git worktree，所有命令在此目录跑，**别 cd 到原始仓库**）
- **分支**：`feat/atelier-pilot-20260611-161001`
- **回退 tag（任何时候可 reset）**：
  - `pre-r2v-refactor` → `4eb3bab`：**重构前全量回退锚点**（`git reset --hard pre-r2v-refactor` 丢弃所有 R2V 改动）
  - `r2v-refactor-foundation`：地基完成里程碑（Stage 1-4 + 6）
  - `pre-dialogue-refactor` / `pre-rail-refactor`：两个高风险阶段前锚点
- **提交作者约定**：`Mike4Ellis`，**不写任何 Co-Author 行**（不写 Claude/Codex/Mogu/谁）。提交前确认 `git config user.name` = Mike4Ellis（本机子仓库可能继承公司身份）。每阶段原子提交。

## 2. 已完成（本会话，都已提交 + 门禁绿）

| commit | 内容 | 阶段 |
|---|---|---|
| `4eb3bab` | 存档 unified mock + pre-refactor 基线 | 1 |
| `75c11f8` | R2V 子树 7 处硬编码靛蓝 glow → per-theme `--glow-primary`/`--btn-pri-glow` token（修 atelier 主题下显错色） | 2 |
| `73e9c8f` | 状态调色板（emerald/amber/red）→ 语义 `status-completed-*`/`accent`/`status-failed-*`（让徽标随主题翻转） | 3 |
| `a59f756` | 8 条硬编码中文 toast → `t()`（恢复 zh/en 切换；storyboardR2V 命名空间 +8 键 parity 175=175） | 4 |
| `6ff0485` | ParamsSection 模型选择 pill-wall → **下拉框**（保留 handleModelChange 重置 + ref 警示） | 6 |
| `3ab5dd3` | ShotCard 生成行加 **gen-sum 摘要芯片**（`● 模型 · 时长s`，折叠时也可见；calm-default 默认折叠早已实现） | 10 |
| `2e21688` | PipelineSidebar 侧栏 **per-step 阶段状态 + 三态点 + 软门槛锁 + 真实项目卡**（script 无字段不给状态=诚实；assembly 软门槛仍可点，不改导航） | 13 |
| `1f3f171` | 模型下拉 **portal 化**修 z-index（之前被下方镜头框挡住） | bug 修 |

**门禁**（每阶段都过）：`npm --prefix frontend run typecheck`（=0）、`npm --prefix frontend run check:colors`（=0，无硬编码色）、`npm --prefix frontend test`（vitest 124/124，含 `i18n.test.ts` 自动 zh/en parity）。

## 3. 核心缺口（续做这个）

**R2V 分镜台整体视觉/布局没对齐 mock。** 本会话原计划 13 阶段，其中 6 个（5/7/8/9/11/12）被我判为"no-op（现有组件已贴近 mock）"——**这个判断是错的**。现有组件的**结构元素**（banner / 镜头列表 / ShotCard 的 preview+editor+gen-row+disclosure+panel+dialogue / queue）确实在，但**布局/间距/视觉层级/具体样式**没对齐 mock。需要真正的视觉重塑。

### 续做步骤建议
1. **先开 mock 当 spec**：`open docs/design/tasty-sam/storyboard-r2v-unified.html`，把它的镜头卡结构 + CSS 读懂（`<article class="card">` → card-top / card-body(preview+editor) / actions(gen-row) / disc(调整) / panel(sec×3) / dia）。
2. **读真实组件**：`frontend/src/components/modules/storyboard-r2v/ShotCard.tsx`（~1000 行，镜头卡）、`StoryboardR2V.tsx`（~2300 行，工作台壳）、`shot-panel/SectionShell.tsx`、`ParamsSection.tsx`、`CandidatesSection.tsx`、`CandidateThumb.tsx`、`T2ISubsection.tsx`、`GenerationBanner.tsx`、`DialogueAudioRow.tsx`、`shot-panel/TaskQueuePanel.tsx`。
3. **逐组件对齐 mock 的布局/样式**（皮 + 结构），从 ShotCard（最显眼）开始。保留所有功能接线（见 §4 preserve-list）。
4. **每改一处**：过三道门禁 + 真实浏览器看像不像 mock（见 §5 验证）。

### 重点对齐项（mock vs 现状的疑似 gap，需肉眼确认）
- 镜头卡 `card-body`：mock 是 **preview 左 + editor 右**两列；现状需核对是否一致、间距/圆角/浮起感。
- 生成行（actions）：mock 是 **gen-sum + 数量 + Generate** 一条；现状已有（Stage 10 加的 gen-sum），核对样式。
- 「调整」disclosure + 折叠 panel：mock 默认折叠、展开后 sec(首帧 T2I)/sec(参数)/sec(候选) 三段；现状有 SectionShell 折叠，核对顺序=**首帧→参数→候选**（spec v3 要求，**别用 mock 之外的顺序**）。
- 右侧 queue：mock 常驻可收起；现状 TaskQueuePanel 是 toggle，核对是否常驻。
- 整体 Atelier 皮：近无框、Fraunces 焦点、teal/amber、bloom/grain/halation——现状组件部分已 token 化，但整体观感需核对。
- **注意**：mock 里有 `prevrail`（上一集参考）已被用户要求**移除**（"暂时不需要"）——别加回来。真实代码有 `PreviousEpisodeFramesRail`，可保留但不必突出。

## 4. 硬约束（用户明确要求，任何改动都要保）

1. **i18n**：所有文案走 `t()`，zh/en 两份 parity。`npm test` 里 `i18n.test.ts` 自动校验 key 集合一致（单边加键会 CI 红）。新文案加到 `frontend/messages/{zh,en}.json`。
2. **多主题**：只用语义 token，**零硬编码色**。`npm run check:colors` 守门（但注意：它**只禁 `#hex` 和 `-white/<alpha>`，不拦 Tailwind 调色板 util 如 `emerald-400`**——那种要手动避免，或改 `status-*`/`accent` token）。五主题：atelier-dark（默认 teal）、bridge-dark、brand-dark、atelier-light、brand-light。每次改色要在 **atelier-light（最难）+ 2 个暗主题**上肉眼看翻转。
3. **功能零丢失**：现有所有可点功能点必须保留。本会话工作流产出过一份 **120 点 preserve-list**（工具栏 addShot/智能分镜/全部展开折叠、StepHeader 画风/queue、ShotCard 模式 Tab/Cast 头像/prompt/Cmd+E/展开预览/pin/retry/cancel/资产抽屉/上下移/复制/删除/单帧精修、ParamsSection 全参数 + 高级折叠 + 换模型重置、Candidates 筛选/排序/对比/批次/复用/star/pin/retry、DialogueWorkbenchModal 情绪 chips/TTS/dub mark-start/offset/preview/apply/revert、GenerationBanner 批量对白 CTA、TaskQueue tabs/jump/cancel/retry/copy-diagnostics、PreviousEpisodeFramesRail）。**改布局时别断这些接线。**
4. **全部测试可用**：vitest 124/124 + 真实浏览器交互测试改到的功能点。
5. **作者 Mike4Ellis，无 Co-Author 行，原子提交。**

### 已知"易在重塑里丢"的细节（对抗校验点名）
- Cmd/Ctrl+E 开 PromptExpand、Cmd/Ctrl+Enter 保存；Shift+Click 候选=对比选择；CompareModal Space/S/Esc；FieldTagChip Esc + click-outside；T2ISubsection 拖拽 + 同文件重选（`input.value=''`）；PendingTaskAffordance Cancel（卡死阈值后才出）；label commit-on-blur；每批次 reuse-params；queue copy-diagnose/copy-ids；Pin/Unpin hover chip；cast-avatar→Cast nav；画风 pill；GenerationBanner phase 机（phase1 轮播文案 / phase2 精修进度 / 对白进度 / summary CTA）。
- **别把 Params vs Candidates 的 SectionShell 内部独立折叠拍扁成单个「调整」**——`ShotPanel` 靠 `usePanelSectionState` 防御独立折叠，保留内层。
- 事件名是跨壳契约，**精确保留**：`document 'lumenx:navigateStep'`（cast/art_direction）、`window 'navigateStep'`（script，来自 generate dialog）、`window 'lumenx:panel-section-override'`（全部展开/jump-to-shot）。
- 重状态机**别 remount/re-key**：debounced persistPrompt、persistWorkbench（tab_mode/t2i urls+index/generate_count）、3s 字段 autosave、expand-state localStorage `storyboard-r2v-expanded-<projectId>`、`usePanelSectionState` localStorage + override 事件、model localStorage `storyboard-r2v-model`/`-r2v-model`、unmount flush + beforeunload、轮询 effects。

## 5. 验证方法（**重要：本会话踩过的坑**）

### 5.1 跑起来
- 前端 dev：`cd frontend && npx next dev -p 3008`（或 `npm --prefix frontend run dev`）。后端在 `:17177`。
- **R2V 项目（测试用）**：`fe6d51f3-c746-4726-ac1b-e9cd520ca953`（60 帧，`workflow_mode=r2v`，EP01）。另一个 r2v：`2e2e0b28-b5ad-4cf5-ada4-9a084785acf1`（1 帧）。**注意：27 个项目里 25 个是 `i2v_legacy`，只这 2 个是 r2v**——只有 r2v 项目走 `StoryboardR2V`（重构目标）；legacy 走 `StoryboardComposer`（未纳入）。
- 打开：`http://localhost:3008/#/project/fe6d51f3-c746-4726-ac1b-e9cd520ca953` → 左栏点「4. Storyboard」→ 工具栏「全部展开」看镜头面板。
- **output 符号链接坑**：worktree 的 `output/` 必须是**一条**指向主仓库 `output/` 的 symlink（StaticFiles 拒绝逃逸 realpath）。若图片 404，检查 `ls -l output`。

### 5.2 before/after 截图（**用这个方法，别用 HMR 回退**）
**HMR 回退法不行**（`git checkout pre-r2v-refactor -- frontend/` + 等 HMR → 有时序竞争，before 会拍到 after 态，图就一样了）。

**可靠法**（本会话最终验证可用）：
```bash
# 1. 建临时 worktree 在老代码 + 第二个 dev server
git worktree add /tmp/r2v-before-wt pre-r2v-refactor
ln -s "$(pwd)/frontend/node_modules" /tmp/r2v-before-wt/frontend/node_modules
(cd /tmp/r2v-before-wt/frontend && npx next dev -p 3009 &)
# 等 :3009 编译就绪（curl 200）
# 2. puppeteer 分别截 :3009(before) 和 :3008(after) 同一视图
# 3. 清理
kill $(lsof -ti:3009); git worktree remove /tmp/r2v-before-wt --force
```
截前点「全部展开」让模型选择器（pills vs 下拉）可见——否则折叠面板里藏住，图看起来一样。

### 5.3 before/after HTML（已存在，续用）
`docs/design/tasty-sam/theming/r2v-before-after.html` + 截图在 `theming/review-assets/`。续做时把新截图覆盖进去、更新 diff 注记。**别覆盖其他轮次的 compare**（`playground-compare/`、`theming/modal-compare.html` 是别的）。

### 5.4 ⚠️ 视觉自检（本会话的致命伤）
**本会话的 Read 工具无法渲染 PNG**（读截图返回空，换了 4 个模型都没用——是 harness 工具层限制，非模型能力）。导致我靠 DOM 文本推断"应该不同"，反复翻车（before/after 拍成 identical、误判 no-op）。

**新会话务必先确认你能看到截图**：`Read` 一张 `review-assets/r2v-sb-after.png`，若返回空，就改用**别的方式自检视觉**（如：把截图转 base64 内联进 HTML 自己看、或直接肉眼看运行中的 app vs mock）。**别重蹈覆辙靠 DOM 文本假设视觉。**

## 6. 相关设计文档（背景）
- `docs/design/r2v-workflow-v3-unified.md`：R2V 工作流 v3 spec（unified i2v+r2v、删 dead step 7/8/9、音频管线）。音频按 spec：**分开存储、Assembly 处一次性 mux**（别学 mock 早期版本里的"覆盖视频/dub offset"逐帧合成——那是错的，已纠正）。
- `docs/design/tasty-sam/storyboard-r2v-unified.html`：**本次对齐的 mock spec**。
- `docs/design/tasty-sam/line-b-atelier/`：Line B（Luminous Atelier）原 mock 们（皮参考）。
- `docs/design/tasty-sam/theming/storyboard-r2v.html`：theming 定稿版（五主题）。

## 7. 本会话未解决的小遗留
- `tests/test_model_catalog.py` 有 **2 个预存失败**（断言 `r2v_model == wan2.7-r2v`，但 `catalog.meta.yaml` 早已写 `happyhorse-1.0-r2v`）——**与本会话改动无关**（我用 stash 基线证实过）。可顺手修断言。
- `VideoConfigModal.tsx` 里的硬编码靛蓝 glow **未改**（组件已退役不挂载，出 scope）。
- 类别色（FieldTagChip/AssetChipBar/AssetDrawer 的 char=blue/scene=green/prop=orange）**有意保留**（类别标识色，跨主题稳定，别抹成 status token）。
- i18n 残留：T2ISubsection/CompareModal/CandidateThumb/TaskQueuePanel/ParamsSection/CandidatesSection 里的 **aria-label/title/placeholder 英文字面量**未提取（本会话 Stage 4 只做了可见中文 toast）。续做时可补，或并入皮肤阶段。

## 8. 续做第一天的建议清单
1. 确认能在你的环境**看到截图**（§5.4），定下视觉自检方式。
2. 开 mock + 真实 app 同屏对比，列出** top 5 视觉 gap**（镜头卡布局？工作台壳？queue 常驻？间距/圆角？某处皮？）。
3. 从最大 gap 起，逐组件重塑，每处：改 → 三门禁 → 浏览器看像不像 → 原子提交。
4. 全部对齐后，重拍 before/after（§5.2 可靠法）更新 `r2v-before-after.html`。

---

**一句话给新会话**：mock 是 `docs/design/tasty-sam/storyboard-r2v-unified.html`；已做的增量在 git 历史（`pre-r2v-refactor` 可回退）；核心未做的是**视觉/布局对齐 mock**；硬约束=i18n parity + 多主题 token + 零功能丢失 + 全测试；**先确认你能看图再动手**，别靠 DOM 文本猜视觉。
