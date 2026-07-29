# R2V Workflow v3 · Unified Workflow + Audio Pipeline 设计方案

> **Status**: ✅ Design approved · Pending implementation
> **Date**: 2026-05-25
> **Author**: grill-me session（用户 + Claude，11 个核心决策）
> **Scope**: 把 LumenX Studio 的 i2v_legacy 9-step workflow 与 R2V 5-step workflow **合并为单一 unified workflow**；把 Voice / Mix / Export 三个 dead step 的功能 **下沉到 Cast / Storyboard / Assembly**；引入完整 audio pipeline（dialogue TTS 自动化 + BGM + Mixer + ffmpeg mux）
> **Supersedes**: `r2v-workflow-v2.md` 的 Storyboard / Assembly 章节；其余章节（Series 架构、Cast 三段、Reconcile 等）保留
> **Backward compat**: 老 i2v_legacy 项目 **不删 components、不强迁数据**，继续走原 9-step 路径；新项目走 unified

---

## 1. 背景与动机

### 1.1 触发本次重塑的两个发现

#### 发现 A · Step 7 (Voice) / 8 (Mix) / 9 (Export) 是 dead UI

- `export.py` 是 mock：`time.sleep` + 写 `b'dummy video content'` 假文件，**完全没做导出**
- `/projects/{id}/export` API 实际忽略 `resolution / format / subtitles` 三个参数（注释明说 "accepted but not yet applied"），逻辑等于 `merge_videos`
- VideoAssembly (Step 6) 已经能 merge + 预览 + 下载，**Export step 跟 Assembly 完全功能重叠**
- R2V workflow 5 步没有 Export / Voice / Mix —— 证明产品方向已经接受 "Assembly = 终点"

#### 发现 B · i2v_legacy 与 R2V workflow 在 backend 已经 unified，只是 frontend 分裂

| 层 | 现状 | 含义 |
|---|---|---|
| Video model | 同 model 支持 i2v + r2v + v2v（Wan, Vidu 等） | model 层不区分 |
| Frame model | `generation_mode: "i2v" \| "r2v"` 是 per-frame 字段 | backend 已是 per-frame mode |
| VideoTask | `r2v_source_tab: "t2i_i2v" \| "direct_r2v"` | 已记录 shot 用了哪个子模式 |
| R2V Storyboard workbench | shot card 已支持 `tabMode` toggle（`T2ISubsection.tsx` 注释："t2i_i2v 模式下『先生图、再生视频』的工作流容器"）| **已是 unified workflow 的实际形态** |
| i2v_legacy workflow | StoryboardComposer + VideoGenerator 独立两个 step | **仅 frontend 层有这个分裂；backend 视角不存在** |

### 1.2 第一性原理

视频生成的本质 = **给模型 (text + 0+ ref images + 0/1 first frame) → output video**。

i2v vs r2v 是 **model input shape 差异**（first frame vs ref images），不是 workflow 概念差异。R2V workbench 已经认识到这一点。

### 1.3 设计目标

1. **单一 workflow** —— 5 步 unified（i2v 通过 shot 内 tab 实现）
2. **音色绑定下沉** —— Voice step 删除，音色绑定到 Cast，dialogue audio 在 Storyboard 触发
3. **Assembly super-step** —— 接管 BGM / Mixer / Export 作为子面板
4. **Backward compat** —— 老 i2v_legacy 项目零迁移，继续走原路径
5. **修复 shot card 内部 UX 痛点** —— t2i_i2v 模式两阶段布局；参数/Takes 按钮显眼化

---

## 2. 决策清单（grill-me 11 个决策）

### Q1 · Workflow 重塑矩阵
**音色下沉 Cast，对白 audio 在 Storyboard frame-level 自动生成，Assembly 接管 BGM/Mixer/Export 作为子面板，删除 Step 7/8/9**。

### Q2 · Cast 卡片 voice binding UI
**A · 卡片底部 hover-only 双行**：hover 时露出 `🔊 Long Cheng ▼` (dropdown) + `▶` (试听) 两个按钮；speed/pitch/volume 调音进 character detail modal/drawer 的 voice tab。

### Q3 · Voice picker 形态
**C · Modal voice library**：卡片网格 + 分组（男声 / 女声 / 童声 / 特殊）+ 顶部"推荐"区 + 每卡片 inline ▶ + 当前选中 primary border 标记。

### Q4 · Voice 推荐算法
**L1.5 (gender-based curated 4 voice) + L4 (AI 推荐按需触发) hybrid**：
- 静态 default：男声 / 女声各 hard-code 4 个 "通用最不会出错"的 voice 作为 highlight
- modal 内 `✨ 让 AI 帮我挑` 按钮触发 LLM，基于 character.{name, gender, age, description, persona} 推荐 3 个
- LLM 返回后替换 highlight 区前 3 个，第 4 个保留 L1.5 fallback

### Q5 · 试听文本 + Cache 策略
- **文本**：character 有 dialogue → 用第一句 dialogue；无 dialogue → fallback `"你好，我是{name}。今天遇到件有趣的事，让我慢慢说给你听。"`（character.name 空时再 fallback `"你好，这是音色试听..."`)
- **Cache**：c · on-demand + memcache（key = `${voice_id}__${md5(text + speed + pitch + volume)}.mp3`）；不预渲染
- **同时只能一个 audio 在播**（点新 voice 自动停旧）

### Q6 · Dialogue audio trigger 模式
**A4 · 混合 batch + inline**：
- Storyboard top 按钮 `🎙️ Generate All Audio` 跑全部 frames 的对白 audio
- 每个 frame card DIALOGUE 区下方 inline audio 行：未生成 → `[⚡ Generate]`；生成中 → `⏳ Generating`；完成 → `🎙️ Long Cheng · 8s [▶] waveform [↻]`；stale → `⚠️ stale - dialogue updated [↻]`
- Stale 检测：比对 `frame.dialogue_audio_text_hash` vs 当前 `frame.dialogue`

### Q7 · Assembly IA
**F · Phase-based vertical progressive disclosure**：
- left main column 垂直堆 Phase 1-3，inspector 保持单一职责（Variants per-frame）
- Phase 1（merge 前配置）：frame variants list + BGM section（collapsible）
- Action button: `[Merge & Preview]`
- Phase 2（merge 后微调）：Merged video preview + Mixer 4-slider section
- Action: `[Apply Mixer → re-merge]`
- Phase 3（最终导出）：Export 配置 + `[Render Final]`

### Q8 · Audio 生成 step
**W4 · Multi-step ubiquitous**：
- **Storyboard primary**：主流程（dialogue 写完后 batch generate）
- **Assembly fallback**：补救（review 时发现某 frame audio 不对，inline regenerate）
- Motion step 不加 audio (VideoCreator 不是 per-frame view，UI 不合适)
- 数据模型选项 1：`frame.dialogue_audio_url` 独立 store，Assembly 一次性 mux 多轨

### Q9 · Workflow 合并 + Backward compat
**新项目可选 unified（default）vs legacy；老项目自动落 legacy；不删 legacy components**：
- 项目级 enum `workflow_mode: "unified" | "legacy"`（替代当前 `"r2v" | "i2v_legacy"` 二选一）
- 新项目创建时有 "视觉控制偏好" 开关：
  - **画面优先** → `default_generation_mode = "i2v"`（先生首帧 → review → 生 video）
  - **节奏优先** → `default_generation_mode = "r2v"`（直接 refs → video）
- 每个 shot 仍可 per-shot override

### Q10 · t2i_i2v shot card 内部 layout
**B · 重组两个 Step section**：
- **Prompt 是 shared input** —— 跟 t2i_i2v / direct_r2v 模式 orthogonal，**永远在 ShotCard top（always visible）**，不进 Step 1 或 Step 2
- **direct_r2v mode**：attached panel 渲染顺序 ParamsSection → CandidatesSection（不变）
- **t2i_i2v mode**：attached panel 渲染顺序 **T2ISubsection (Step 1) → ParamsSection (Step 2) → CandidatesSection**
  - **Step 1 · 首帧 (T2ISubsection)**：`[由提示词生成]` `[上传图片]` 双口 CTA + first frame preview + first frame candidates (复用 ShotCard top 的 prompt)
  - **Step 2 · 生成视频 (ParamsSection)**：I2V PARAMS + `[生成 ×N]` + video candidates 落在 CandidatesSection
- v1 实施 Option A · 最小修复：仅调换 attached panel 内 ParamsSection ↔ T2ISubsection 顺序
- v1 不做：Step 2 顶部 first frame thumbnail（视觉锚点）、Step 2 在无 first frame 时按钮 disabled（v1 后看用户反馈决定升级到 Option B/C）

### Q11 · "参数 / Takes" 按钮位置
**B · 中下方全宽 disclosure bar**：
- 从 actions row 末端（右下小 chip）移到 ParamsSection 顶部全宽 disclosure header
- 折叠态：`▾ 参数 / Takes  ·  Wan 2.6 I2V · 720p · ×1`（含 params summary）
- 展开态：`▴ 参数 / Takes (收起)` + 下面展开完整 params 区
- 视觉权重提升 5-10 倍，解决 "找不到" 痛点

### Q15 · TTS 能力范围（2026-05-25 grill,基于完整 doc audit）
**5 个 sub-decision 全部按推荐**：

**Q15.1 · Voice model family v1 范围**: **CosyVoice + Qwen3-TTS** (Qwen3 方言 voices 对中国短剧创作核心场景极有价值；MiniMax 暂缓)

**Q15.2 · 声音复刻 (Voice Cloning) v1**: **做 — character 详情侧 drawer 加"复刻" tab** (创作者高频需求"用朋友录音作角色")。API: `POST /services/audio/tts/customization` model=`voice-enrollment`/`qwen-voice-enrollment` action=`create_voice`/`create`

**Q15.3 · 声音设计 (Voice Design) v1**: **做 + character.description 一键转 voice_prompt** (复用 description 同时驱动 image + voice，LumenX 核心 leverage). API: 同上 endpoint 不同 model (`voice-enrollment`/`qwen-voice-design`)

**Q15.4 · 指令控制 UX**: **chip + 自由文本双轨** (90% 用户用 6-8 个 preset chip 够；10% advanced 写自由文本)。后端统一翻译为 `instructions` 参数 (CosyVoice ≤ 100 字符, Qwen3 ≤ 1600 token)

**Q15.5 · Voice picker modal 形态**: **Tabs `[系统音色 | 我的复刻 | 我的设计]`** (按"来源"分组，跨 family 在每个 tab 内分组)。系统音色 tab 内再二级分 CosyVoice / Qwen3 / 方言

### Q15 影响（之前 spec 假设修正）
- ❌ `cosyvoice-v3-flash` 是 v3 主推 → ✅ `cosyvoice-v3.5-plus` / `v3.5-flash` 是当前主推 (v3.5 系列不支持系统音色，只支持复刻/设计)
- ❌ Emotion = 固定 7 enum + 固定中文格式 → ✅ 自然语言 instructions 参数 (≤100 字符)
- ❌ 复刻/设计 = v2 backlog → ✅ first-class API，PR-3 v1 范围
- ❌ tts.py 30 voices 够 → ✅ 162 CosyVoice voices + 35+ Qwen3 voices 待补充

---

## 3. New Architecture

### 3.1 Unified 5-step workflow

```
Script · Style · Cast · Storyboard (= StoryboardR2V) · Assembly
```

| Step | 职责 | 关键扩展 |
|---|---|---|
| 1 Script | 剧本解析（不变）| — |
| 2 Style | 风格定调（v2 Series 架构，不变）| — |
| 3 Cast | 角色 / 场景 / 道具（v2 三段架构 + 跨集 reconcile） | **+ voice binding hover dropdown + Voice picker modal** |
| 4 Storyboard | 分镜编排（= StoryboardR2V workbench） | **+ t2i_i2v 两 Step section + 参数按钮重定位 + dialogue audio row + top batch button** |
| 5 Assembly | 最终合成 + 导出 | **+ BGM section + Mixer 4-slider + Export 配置 + 真实 ffmpeg multi-track mux** |

### 3.2 Project-level workflow_mode 字段（替代当前定义）

```python
class Project(BaseModel):
    workflow_mode: str = Field(
        "unified",
        description="Workflow mode: 'unified' (new, default) or 'legacy' (i2v_legacy backward compat)"
    )
    default_generation_mode: str = Field(
        "r2v",
        description="Default for new shots in unified mode: 'i2v' (画面优先) or 'r2v' (节奏优先)"
    )
```

**老项目迁移逻辑**（数据无迁移，仅 frontend 路由判断）：
- 现 `workflow_mode == "r2v"` → 视为 `"unified"`（走 StoryboardR2V）
- 现 `workflow_mode == "i2v_legacy"` → 保持 `"legacy"`（走原 9-step）

### 3.3 Per-frame generation_mode（已有，复用）

```python
class Frame(BaseModel):
    generation_mode: str = "i2v"  # "i2v" | "r2v" - 已有字段
    workbench_tab_mode: str = "direct_r2v"  # "t2i_i2v" | "direct_r2v" - 已有字段
```

新增字段（audio pipeline）：
```python
class Frame(BaseModel):
    # ...existing
    dialogue_audio_url: Optional[str] = None  # TTS 输出
    dialogue_audio_text_hash: Optional[str] = None  # stale 检测
    dialogue_audio_voice_id: Optional[str] = None  # 生成时用的 voice
    dialogue_audio_updated_at: Optional[float] = None
```

```python
class Project(BaseModel):
    # ...existing
    bgm_url: Optional[str] = None  # 项目级 BGM
    bgm_volume: float = 0.6  # Mixer 默认值
    mixer_dialogue_volume: float = 1.0
    mixer_video_audio_volume: float = 0.0  # default mute video native audio
    mixer_sfx_volume: float = 0.8  # v1 reserved (no UI)
    export_format: str = "mp4"
    export_aspect: str = "16:9"
    export_subtitle_mode: str = "none"  # "burn-in" | "srt" | "none"
```

### 3.4 Backward compat: legacy workflow 保留策略

- **不删** `StoryboardComposer.tsx`、`VideoGenerator.tsx`、`ConsistencyVault.tsx`、`ExportStudio.tsx`、`VoiceActingStudio.tsx`、`FinalMixStudio.tsx`
- ProjectClient 路由：`workflow_mode === "legacy"` → 走 `LEGACY_STEPS`（9 步原路径）；`workflow_mode === "unified"` → 走 `UNIFIED_STEPS`（5 步新路径）
- 老项目可手动 switch 到 unified（项目 settings 加按钮），但 default behavior 是不切换
- PR-1 / PR-2 的 chrome 对齐成果（StepHeader + WorkflowActionButton + 杂色收敛）继续对 legacy 项目生效

---

## 4. UI Specs

### 4.1 项目创建流程（新增"workflow + 视觉控制偏好"开关）

PromptConfigModal 或 NewProject Modal 加一个新 section：

```
┌──────────────────────────────────────────────────────┐
│ 工作流模式                                            │
│                                                       │
│   ● Unified Workflow (推荐)                          │
│     5 步精简流程，per-shot 可选 i2v / r2v 生成模式   │
│                                                       │
│   ○ Legacy Workflow                                  │
│     传统 9 步流程，保留向后兼容                       │
│                                                       │
│ ──────────────────────────────────────               │
│                                                       │
│ 视觉控制偏好 (unified 模式下生效)                     │
│                                                       │
│   ● 节奏优先 (推荐 default)                          │
│     新建镜头默认 direct_r2v，速度优先                 │
│                                                       │
│   ○ 画面优先                                          │
│     新建镜头默认 t2i_i2v，先生首帧再生视频            │
└──────────────────────────────────────────────────────┘
```

### 4.2 Cast step 扩展

#### 4.2.1 Character 卡片 hover bar

每个 character 卡片 hover 时底部 actions 区**加 voice 行**（Generate / Upload / Lock / Delete 之上）：

```
┌─ Character Card ──────────────┐
│ [image as bg]                 │
│                               │
│ 林墨                          │
│ 主角 · 江湖游侠               │
│ ┌──────────────────────────┐ │
│ │ 🔊 Long Cheng        ▼ ▶ │ │ ← 新增 voice 行 (hover only)
│ │ ──────────────────────── │ │
│ │ ⚡ Gen  📤 Up  🔒  🗑️    │ │ ← 现有 actions
│ └──────────────────────────┘ │
└───────────────────────────────┘
```

- 点 `▼` → 打开 Voice picker modal (见 4.2.2)
- 点 `▶` → inline 试听（用 4.2.3 的试听文本 + voice）

#### 4.2.2 Voice picker modal

```
┌──── 选择音色 — 林墨 ───────────────────────── × ┐
│                                                 │
│ 推荐 · 基于角色 「男 · 青年」 [✨ 让 AI 帮我挑] │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │ 龙诚 │ │ 龙泽 │ │ 龙书 │ │ 龙安阳│           │
│ │ 睿智 │ │ 阳光 │ │ 播报 │ │ 沉稳 │            │
│ │  ▶   │ │  ▶   │ │  ▶   │ │  ▶   │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
│                                                 │
│ ──────────────────────────────────              │
│ 全部音色                                         │
│                                                 │
│ ─ 男声 (12) ─                                   │
│ [卡片网格 — 每卡含 name + tag + ▶]              │
│                                                 │
│ ─ 女声 (11) ─                                   │
│ [卡片网格]                                       │
│                                                 │
│ ─ 童声 (2) ─                                    │
│ [卡片网格]                                       │
│                                                 │
│ ─ 特殊 (0 — Coming Soon: voice clone upload) ─  │
│                                                 │
│ ────────────────────────                        │
│ [取消]                          [应用]          │
└─────────────────────────────────────────────────┘
```

**推荐算法 L1.5**：
- 项目 hard-code 男声 / 女声各 4 个 curated voice：
  - 男声：龙诚 (睿智青年) / 龙泽 (阳光男) / 龙书 (播报男) / 龙安阳 (沉稳男)
  - 女声：龙小淳 (知性女) / 龙桐 (清新女) / 龙菲菲 (甜美女) / 龙婉 (知性女)
- character.gender 字段 fuzzy match：`"男" / "male" / "Male" / "M"` → 男声 curated；其他 → 女声 curated
- character.gender 为空 → 显示 8 个全部 curated voice 作为推荐区

**L4 AI 推荐**：
- 点 `✨ 让 AI 帮我挑` → 跑 LLM
- prompt: `Given a character: name={name}, gender={gender}, age={age}, description={description}, persona={persona}. From this CosyVoice list [...], recommend 3 voices that best match. Reply JSON: { recommendations: [voice_id × 3], reason: "..." }`
- 返回后替换 highlight 区前 3 个，第 4 个保留 L1.5 fallback

#### 4.2.3 试听 audio 生成

- **文本规则**：
  ```python
  def get_preview_text(character, frames):
      char_dialogue = next((f.dialogue for f in frames 
                            if character.id in f.character_ids and f.dialogue), None)
      if char_dialogue:
          return char_dialogue  # 用真实 dialogue
      name = character.name or "我"
      return f"你好，我是{name}。今天遇到件有趣的事，让我慢慢说给你听。"
  ```
- **TTS 调用**：`POST /tts/preview` `{voice_id, text, speed=1.0, pitch=1.0, volume=50}`
- **Cache key**: `${voice_id}__${md5(f"{text}|{speed}|{pitch}|{volume}")}.mp3`
- **Cache 位置**: `output/cache/voice_preview/{cache_key}`
- **后端**: 检查 cache → 命中直接返回 URL；未命中 → 跑 CosyVoice → 写 cache → 返回
- **前端**: 同时只能一个 audio 元素在播；点新卡片 ▶ 时先 `.pause()` 旧 audio

### 4.3 Storyboard (Unified) step

#### 4.3.1 Shot card 整体布局 — direct_r2v 模式（单 panel，不变）

```
┌─ Shot Card · direct_r2v ──────────────────┐
│ [Tab: 首帧+I2V | 多参考R2V]            #01 │
│                                            │
│ Prompt 输入框                              │
│                                            │
│ ▾ 参数 / Takes · HappyHorse R2V · ×1      │ ← 新位置 (Q11)
│ ──────────────────────────────             │
│ Refs: [@林墨] [@古城夜雨]                  │
│                                            │
│ ──── Dialogue audio row ─── (Q6) ───       │
│ 🎙️ Long Cheng · 8s [▶] waveform [↻]      │
│ ──────────────────────────────             │
│                                            │
│ [生成 ×N 主按钮]              ↑ ↓ ⊙ ×   │
│ ──── CANDIDATES ───                        │
└────────────────────────────────────────────┘
```

#### 4.3.2 Shot card 布局 — t2i_i2v 模式（两 Step section，v1 Option A 最小修复）

**关键**：Prompt 在 ShotCard top（always visible，shared input），不进 Step 1 / Step 2。

```
┌─ ShotCard always-visible part ─────────────┐
│ [Tab: 首帧+I2V | 多参考R2V]            #01 │
│ Prompt input (shared between Step 1 + 2)   │
│ [chip bar / asset references]              │
│ ↑ ↓ ⊙ × (actions)                          │
└────────────────────────────────────────────┘

(展开后) attached workbench panel:
┌─ STEP 1 · 首帧 (T2ISubsection) ───────────┐
│ [由提示词生成] [上传图片] 或拖拽至此       │
│ ┌─ first frame preview ─┐                  │
│ │ (生成后填充)          │                  │
│ └───────────────────────┘                  │
│ ▾ first frame candidates                   │
└────────────────────────────────────────────┘
┌─ STEP 2 · 生成视频 (ParamsSection) ────────┐
│ ▾ 参数 / Takes · Wan 2.6 I2V · 720p        │ ← 新位置 (Q11)
│ ──── I2V PARAMS (展开时) ───               │
│                                            │
│ [生成 ×N]                                  │
└────────────────────────────────────────────┘
┌─ video CANDIDATES (CandidatesSection) ─────┐
│ ▾ Candidates: 2 done / 1 running           │
└────────────────────────────────────────────┘
```

**Dialogue audio row** 是 PR-3g 范围（不在 PR-3a），位置见 §4.3.4。

**v1 Option A 仅做**: attached panel 渲染顺序调换为 T2ISubsection → ParamsSection → CandidatesSection（当前是 ParamsSection → T2ISubsection → CandidatesSection）。

**v2 可升级到 Option B/C**: 加 explicit section header / Step 2 顶部 first frame thumbnail / Step 2 无 first frame 时 disabled。看 v1 用户反馈决定。

#### 4.3.3 Storyboard top bar 新增 batch button

```
[StepHeader 04 · Storyboard]
trailing: [count] [View Script] [🎙️ Generate All Audio] [Generate Storyboard ⚡]
```

`🎙️ Generate All Audio` 行为：
- 找所有 frames 里 `dialogue` 非空 + character_ids 已绑 voice + (audio 未生 OR stale) 的 frames
- 并发跑 CosyVoice TTS（每 frame 一个 task）
- 进度条在 StepHeader trailing 显示 `Generating 12/30...`

#### 4.3.4 Per-frame dialogue audio row spec

- **位置**：DIALOGUE 区下方（direct_r2v 整体在 Prompt 下方；t2i_i2v 在 Step 2 内）
- **5 个状态**：
  | 状态 | 显示 | 触发 |
  |---|---|---|
  | 无 dialogue | 不显示 | — |
  | 未生成 | `🎙️ 待生成 [⚡ Generate]` | dialogue 已写但 audio 未生 |
  | 生成中 | `🎙️ Long Cheng · ⏳ Generating...` | TTS 跑中 |
  | 完成 | `🎙️ Long Cheng · 8s [▶] waveform [↻]` | TTS done |
  | Stale | `🎙️ Long Cheng · 8s [▶] ⚠️ stale [↻]` | `frame.dialogue_audio_text_hash` ≠ `md5(frame.dialogue + voice_id + ...)` |
  | 失败 | `🎙️ ❌ 生成失败 [retry]` | TTS error |
- **character 未绑 voice 时**：`🎙️ ⚠️ 需要先在 Cast 为「林墨」绑定音色 [→ Cast]`（点击 dispatch `lumenx:navigateStep` event 跳 Cast）

### 4.4 Assembly step (Phase-based)

```
┌─ Assembly ────────────────────────────────────────┬─────────────┐
│ StepHeader · 12/18 frames ready                   │ Inspector   │
├───────────────────────────────────────────────────┤             │
│                                                   │ SidePanel   │
│ ▼ Phase 1 · Pick frame variants  (always show)    │ "Variants"  │
│   ┌─────────────────────────────────────────────┐ │             │
│   │ Frame #1 [preview]  selected: var2         │ │ 不选 frame: │
│   │ Frame #2 [preview]  selected: var1         │ │  placeholder│
│   │ ...                                         │ │             │
│   └─────────────────────────────────────────────┘ │ 选 frame:    │
│                                                   │  variants    │
│ ▼ Phase 1 · 配乐 BGM  ▸ (collapsed default)       │  cards       │
│   ┌─────────────────────────────────────────────┐ │  (现有不动) │
│   │ [Mood preset library] [Upload BGM]          │ │             │
│   │ [Volume slider]                             │ │             │
│   └─────────────────────────────────────────────┘ │             │
│                                                   │             │
│ ─────────────────────────────────────────────── │             │
│ [Merge & Preview →]   主按钮                      │             │
│ ─────────────────────────────────────────────── │             │
│                                                   │             │
│ ▼ Phase 2 · Merged Preview  (merge 后展开)        │             │
│   [Merged video player + controls]                │             │
│                                                   │             │
│ ▼ Phase 2 · Mixer  (merge 后展开)                 │             │
│   Dialogue     ─●──── 100%                        │             │
│   BGM          ──●─── 60%                         │             │
│   Video Audio  ●───── 0%   (default mute)         │             │
│   SFX          ─────── n/a (v1 disabled)          │             │
│   [Apply Mixer → re-merge]                        │             │
│                                                   │             │
│ ▼ Phase 3 · Export  (Mixer apply 后展开)          │             │
│   Format:    [mp4] [mov] [gif]                    │             │
│   Aspect:    [16:9] [9:16] [1:1] [4:5]            │             │
│   Subtitle:  [burn-in] [srt] [none]               │             │
│   [Render Final → ]                               │             │
│                                                   │             │
└───────────────────────────────────────────────────┴─────────────┘
```

**Auto-scroll 行为**：merge 完成自动 scroll Phase 2 进视口；Mixer apply 完成自动 scroll Phase 3 进视口。

---

## 5. Audio Pipeline

### 5.1 TTS 生成（dialogue audio）

| 阶段 | 触发 | 后端 |
|---|---|---|
| **试听 (Cast)** | Voice picker modal ▶ button | `POST /tts/preview` → cache or CosyVoice → return mp3 url |
| **Single frame (Storyboard)** | frame card audio row ⚡ button | `POST /projects/{id}/frames/{frame_id}/generate_audio` → save to `frame.dialogue_audio_url` |
| **Batch (Storyboard)** | top "🎙️ Generate All Audio" button | `POST /projects/{id}/batch_generate_audio` → 并发跑 |
| **Inline regenerate (Assembly)** | Assembly frame list audio status ↻ button | 复用 single frame API |

**所有 TTS 调用经过**：
1. validate `frame.character_ids` 中至少一个 character 有 `voice_id`（多 character 时用第一个 dialogue 角色）
2. compute text_hash = `md5(dialogue + voice_id + speed + pitch + volume)`
3. 跑 CosyVoice
4. 写 `frame.dialogue_audio_url` + `frame.dialogue_audio_text_hash` + `frame.dialogue_audio_voice_id` + `frame.dialogue_audio_updated_at`

### 5.2 Cache 策略

- **Voice picker preview cache**：`output/cache/voice_preview/{cache_key}.mp3` (key 见 4.2.3)
- **Frame dialogue audio**：存 `output/audio/{project_id}/{frame_id}.mp3`，URL 写入 `frame.dialogue_audio_url`
- **Stale 检测**：每次渲染 Storyboard frame card 时 recompute `text_hash` 与 stored `dialogue_audio_text_hash` 比对，不同 → 显示 stale 标记

### 5.3 Audio 合成 (Assembly merge_videos 扩展)

当前 `pipeline.merge_videos(script_id)` 只合 video segments。扩展为：

```python
def merge_videos_with_audio(script_id: str) -> str:
    """
    Multi-track ffmpeg mux:
    - input 1: concat all selected video segments (silent or with native audio)
    - input 2: concat all frame.dialogue_audio_url (按 frame 顺序排列时间轴)
    - input 3: project.bgm_url (循环或截断到总时长)
    
    Audio tracks mux with mixer levels:
    - dialogue: mixer_dialogue_volume (default 1.0)
    - bgm: mixer_bgm_volume (default 0.6)
    - video native audio: mixer_video_audio_volume (default 0.0 muted)
    
    SFX track v1 skip (no UI, no input).
    """
```

ffmpeg pipeline 示例（伪代码）：
```bash
ffmpeg \
  -i concat:video_segments.mp4 \
  -i concat:dialogue_audio.mp3 \
  -i bgm_loop.mp3 \
  -filter_complex "[1:a]volume={dialogue_vol}[a1]; [2:a]volume={bgm_vol}[a2]; [0:a]volume={video_audio_vol}[a0]; [a0][a1][a2]amix=inputs=3[aout]" \
  -map 0:v -map [aout] \
  -c:v copy -c:a aac \
  output.mp4
```

### 5.4 V1 mixer scope

| 轨 | v1 状态 | UI |
|---|---|---|
| Dialogue | ✅ | slider 0-150% |
| BGM | ✅ | slider 0-150% |
| Video Native Audio | ✅ | slider 0-150% (default 0%) |
| SFX | 📦 reserved | UI 不显示（无 source） |

---

## 6. Implementation Plan

### 6.1 PR Roadmap (rewritten 2026-05-25 post Q15)

**已完成 (PR-3a → 3f + Q14 + Action Bar merge)** ✅
| PR | Subject | Commit |
|---|---|---|
| PR-3a | StoryboardR2V t2i_i2v 重组两 Step section | 55d6dbe |
| PR-3b | ShotCard "参数/Takes" disclosure bar | 3ee33bf |
| PR-3c (+ follow-up) | 闭环生成行 + count selector + 去 ParamsSection Generate | 98056f2 + 678560e |
| PR-3d | Shared prompt tooltip | 325f27f |
| PR-3 grill Q14 | T2ISubsection candidates 默认展开 + 显式 Reroll | 1c2ba8a |
| Action Bar merge | 底部一体化 actions + generation cluster | 4e666ea |
| PR-3e | `default_generation_mode` 字段 + CreateSeriesDialog 视觉控制偏好 picker | e39358f |
| PR-3f | "r2v" → "Unified Workflow" 命名 normalize | f55b48f |

**Voice 子序列 (path B 拆 4 个 PR, post Q15)**：

| PR | Subject | 依赖 | Est. |
|---|---|---|---|
| **PR-3g** | Voice picker modal (3 tabs: 系统音色/我的复刻/我的设计) + Cast 卡片 hover dropdown + 试听 + tts.py 扩展 (Qwen3-TTS catalog + cosyvoice-v3.5-flash/plus + 162 CosyVoice voices subset) + backend `/voice/preview` endpoint (memcache) | 无 | 2-3d |
| **PR-3h** | 声音复刻 (Voice Cloning) — character 详情 drawer 加 "复刻" tab + 上传 reference audio + 后端 `/voice/clone` 调 `/customization` action=create_voice → 返回 voice_id 写入 character.voice_id (with origin marker) | 3g | 1-2d |
| **PR-3i** | 声音设计 (Voice Design) — character 详情 drawer 加 "设计" tab + voice_prompt 输入 + "用 character.description 一键转" 智能按钮 (LLM rewrite description → voice_prompt) + 后端调 `/customization` action=create_voice (cosyvoice-v3.5-plus voice_prompt) | 3g | 2d |
| **PR-3j** | Storyboard frame-level dialogue audio row + top batch button + stale 检测 + **chip emotion (8 preset chip + 自由文本 advanced) → instructions 参数** | 3g | 2-3d |

**Assembly + 收尾**：
| PR | Subject | 依赖 | Est. |
|---|---|---|---|
| **PR-3k** | Assembly IA 重组 (Phase-based + BGM section + Mixer 4-slider + Export 子面板) | 3j | 2-3d |
| **PR-3l** | merge_videos 扩展含 audio track mux (ffmpeg multi-track: video + dialogue + BGM) | 3k | 2-3d |
| **PR-3m** | Step 7/8/9 deprecation cleanup (unified 项目跳过；legacy 仍可见；@deprecated 标记) | 3j + 3k + 3l | 0.5d |

**总估时**: ~12-16 days (Voice 子序列 7-10d, Assembly 收尾 4.5-6.5d)

**Dependency 关键路径**: PR-3g → 3h/3i (parallel) → 3j → 3k → 3l → 3m

### 6.2 关键 milestone (post Q15)
1. **PR-3g** = voice 基础设施（picker UI + tts.py catalog + preview endpoint）— 解锁所有后续 voice 工作
2. **PR-3h + 3i** = 自定义音色生产（复刻 + 设计）— 用户能创建专属角色 voice
3. **PR-3j** = audio 实际生成 + emotion 控制 — frame.dialogue → mp3 with emotion
4. **PR-3k + 3l** = 整片合成 + 多轨混音 — 最终视频含 dialogue + BGM

### 6.2 关键 milestone

1. **Quick wins (PR-3a + 3b)** — 立刻修 UX 痛点，1.5-2.5d，不依赖任何外部 input
2. **Unified workflow 入口 (PR-3c + 3d)** — 新项目能体验 unified 流程，1.5d
3. **Voice 工作流 (PR-3e + 3g)** — 等 task #77 → 落地音色绑定 + dialogue audio，4-6d
4. **Assembly 重构 (PR-3h + 3i)** — Phase-based IA + ffmpeg multi-track，4-6d
5. **Cleanup (PR-3k)** — Step 7/8/9 deprecation，0.5d

### 6.3 Dependencies / blockers

| Dep | Owner | Blocks |
|---|---|---|
| task #77: CosyVoice 最新文档 + voice catalog + v3 emotion 支持 spike | user 提供 | PR-3e, PR-3j |
| ffmpeg multi-track filter_complex 实际表现验证 | dev spike | PR-3i |
| Mood preset library 内容（10-20 首 BGM 资源 + 版权）| product 提供 | PR-3h (BGM section) |

### 6.4 Migration / data compat

- 老项目（`workflow_mode in ["r2v", "i2v_legacy"]`）数据 schema 完全兼容 unified
- ProjectClient 路由 normalize：
  - `"r2v"` → 视为 `"unified"` (走 StoryboardR2V)
  - `"i2v_legacy"` → 保持 `"legacy"` (走原 9-step)
- 用户能手动 switch（项目 settings 加 toggle），无强制迁移

---

## 7. V1 Scope

### 7.1 Included
- 5 步 unified workflow + project workflow_mode toggle
- Cast voice binding (hover dropdown + Voice picker modal + L1.5 + L4 推荐)
- Voice picker 试听（on-demand + memcache）
- Storyboard per-frame dialogue audio row + batch generate + stale 检测
- Assembly Phase-based IA + BGM section (preset + upload) + Mixer 4-slider + Export 子面板
- ffmpeg multi-track mux (video + dialogue + BGM, default mute video native audio)
- 老 i2v_legacy workflow 完全保留 (无破坏)
- t2i_i2v shot card 两 Step section 重组
- "参数/Takes" 按钮 disclosure bar 重定位

### 7.2 Excluded → V2 backlog
- **SFX library** （preset SFX library + per-frame SFX 上传 + Mixer SFX 轨）
- **Mixer timeline / keyframe automation**（BGM 自动 ducking, dialogue 高潮加重）
- **BGM 切分 / 多段 BGM**（按 scene 切换）
- **Voice clone upload**（用户自定义 voice，CosyVoice clone API）
- **AI 生成 BGM**（基于剧情情绪自动配乐）
- **Multi-language 字幕**（v1 只 burn-in 中文 / SRT 单语）
- **平台一键发布**（抖音 / B站 / 小红书 OAuth 上传）
- **Chapter markers / 缩略图生成**
- **AI 生成针对 character 的 demo text 试听**（v1 用固定 sample）
- **Per-frame emotion 输入 UI 完整实现**（v1 在 PR-3j 等 spike 后做）

---

## 8. Open Questions / Risks

### 8.1 已知 risk

| Risk | Mitigation |
|---|---|
| CosyVoice 文档 / voice catalog 已变化 | task #77 实施前 user sync 最新文档 |
| ffmpeg multi-track mux 在某些 input shape 下失败 | PR-3i 之前先 dev spike，验证常见 input combos |
| 用户改 dialogue 频繁 → batch audio cost 累积 | stale 标记让用户主动决定，不自动 regenerate |
| Voice picker modal 试听 latency | on-demand + memcache 兼顾首听延迟与重复听 instant |
| 老 i2v_legacy 项目用户拒绝 switch | 不强制，legacy 路径长期保留 |

### 8.2 Open questions（待 implement 时再决定）

- L4 AI 推荐用哪个 LLM (qwen3.6-plus default 还是允许 user configure)？
- Voice picker modal 内推荐按钮 "✨ 让 AI 帮我挑" 跑完后是否提示用户 "AI 推荐了 X / Y / Z，原因：..."？
- BGM preset library 的 10-20 首 mood music 是产品提供还是 user 自上传？
- merge_videos 跑完后 merged_video_url 是否覆盖（每次 re-merge 都是同 URL）还是 versioned（保留历史 mergedVideos）？
- Mixer 4-slider 是否需要 "Reset to default" 按钮？

---

## 9. 决策权威 + 修订

本文档是 **PR-3 系列实施的唯一权威 spec**。实施过程中：
- 跟 spec 一致的细节 → 直接做
- 跟 spec 不一致或 spec 没覆盖的细节 → **stop 并 raise** to user，让用户决定后更新 spec
- 重大方向修订（如新 grill 出 W5 trigger 模式）→ 更新 spec + 在 §2 加新 Q
- v2 backlog 项不在本 spec 实施范围，单独 spec

实施进度同步在 task #78 / #79 / #80 + PR-3a..k 后续 task。
