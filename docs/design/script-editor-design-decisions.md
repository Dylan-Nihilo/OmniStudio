# LumenX 剧本编辑器设计决策文档

> **文档状态**：活跃讨论中（Grill Session）
> **方法论**：第一性原理 + 对抗性验证
> **最后更新**：2026-07-03

---

## 1. 核心定位（Root Decision）

### 1.1 能力分层框架

| 层级 | 定位 | 优先级 |
|------|------|--------|
| **A. 对标 Laper 编辑能力** | Table Stakes — 单独使用不输 Laper | Phase 1 |
| **B. 剧本→视频管线服务** | **核心差异化** — 唯一能让剧本自动变视频的编辑器 | Phase 1 |
| **C. 行业互通（FDX/协作）** | 行业准入门槛 | Phase 1（FDX）/ Phase 2（协作） |
| **D. 差异化护城河** | B 的自然结果 | — |

### 1.2 第一性原理判定

- LumenX ≠ "最好的剧本写作工具"（那是 Laper 的目标）
- LumenX = "唯一能让剧本自动变成视频的编辑器"
- 功能优先级排序：**是否服务于剧本→视频链路** > 是否服务于剧本本身

### 1.3 对抗性验证

- ❌ 单追 A（跟随 Laper）= 跟随者困境，永远是别人的 80%
- ❌ 单追 C（承接迁移）= 等于承认自己是替代品
- ❌ 单追 D（差异化）= 容易飘，做出炫技但没人用的东西
- ✅ B 为体 + A/C 为面 = 独占位置 + 专业品质

---

## 2. Phase 分层

### 2.1 Phase 1（当前执行）

| # | 功能 | 说明 |
|---|------|------|
| 1 | 好莱坞格式排版 | Courier 12pt、精确缩进、分页逻辑 |
| 2 | CJK 格式支持 | 中文/日文，多格式切换（见 §4） |
| 3 | FDX 导入导出 | Final Draft 文件互操作 |
| 4 | Fountain 格式支持 | 纯文本剧本格式导入导出 |
| 5 | 七维度自动派生 | 场景/人物/地点/道具/节拍自动从剧本提取 → 喂视频管线 |
| 6 | 多格式导出 | PDF / DOCX / TXT / Fountain / FDX |
| 7 | 现代 UI 质感 | 对标 Laper 的 shadcn + Tailwind + Framer Motion 体验 |

### 2.2 Phase 2（Phase 1 完成后评估）

| # | 功能 | 决策方式 |
|---|------|---------|
| 6 | CRDT 实时协作 | 从全局第一性原理视角评估"要不要做/怎么做"。当前视频管线非实时交互设计，协作的必要性存疑 |
| 7 | AI 任务→资产管线改进 | 已有基础能力，需系统对比 Laper 方案后从第一性原理设计改进方向 |

### 2.3 暂不考虑

- PLG 商业策略 / 定价 — 等产品成型后统一讨论

---

## 3. 编辑器内核选型

### 3.1 决策：Tiptap

**选定理由**：

1. Laper 已验证可行（65 国用户，Tiptap + Loro CRDT）
2. Phase 2 协作预留 — Yjs 插件级接入，非重写
3. 技术栈一致 — React + Tailwind + shadcn
4. Extension 插件化 — 每种格式元素做成独立 Extension
5. JSON 文档模型 — 天然适合七维派生（AST 遍历）
6. 成熟生态 — InputRule / PasteRule / 序列化
7. 轻量 — core ~20KB gzipped，Extension 按需加载

### 3.2 否决选项

| 选项 | 否决理由 |
|------|---------|
| ProseMirror 裸用 | API 太底层，开发效率低 3-5 倍 |
| Slate.js | CRDT 生态不如 PM 系，社区萎缩 |
| Lexical | 太年轻，缺乏剧本场景验证 |
| CodeMirror 6 | 代码编辑器哲学，不适合块级排版 |
| 自研 | NIH 综合症，编辑器是已解决问题 |

### 3.3 Tiptap 对好莱坞格式的支持方案

- 每种格式元素 → 自定义 Node Extension（SceneHeading / Action / Character / Dialogue / Parenthetical / Transition）
- 排版 → CSS class 控制缩进/对齐/字体
- **分页**：Phase 1 用 CSS 分页模拟（`break-before/after` + 可视分隔线），精度 ~90%；Phase 1.5 可选虚拟分页引擎提升至 99%

### 3.4 关键判断：「即使不做协作，Tiptap 依然最优」

Tiptap 的 7/8 核心价值与协作无关：Extension 架构、JSON 模型、React 绑定、InputRule、序列化、社区生态。仅 Yjs 插件依赖协作。

---

## 4. 剧本格式支持策略

### 4.1 二维正交架构（格式 × 渲染）

Laper 的"CJK 切换"是二元开关。LumenX 将其**升级为两维正交系统**：

```
维度 ①：剧本格式（结构/排版规则）
  → 好莱坞 | 中文电影 | 中文短剧 | 日本动画

维度 ②：文本渲染（字体/排印）
  → Latin (Courier) | CJK 中文 (宋体/黑体) | CJK 日文 (明朝/ゴシック)
```

两维正交意味着可以自由组合，例如"好莱坞格式 + 中文渲染"（中国编剧用好莱坞结构写中文内容）。

### 4.2 格式优先级

| 优先级 | 格式 | 默认渲染 | 目标场景 |
|--------|------|---------|---------|
| **P0** | 中文短剧格式 | CJK 中文 | 竖屏短剧/漫剧创作者日常写作 |
| **P0** | 好莱坞格式 | Latin 或 CJK 中文 | 专业交付 + FDX 互操作 |
| **P1** | 中文电影格式 | CJK 中文 | 院线电影方向 |
| **P1** | 日本动画脚本格式 | CJK 日文 | 日系漫剧创作 |
| **P1** | 分镜脚本视图 | 跟随当前渲染 | 视频管线前的人工检查点 |

### 4.3 日本动画脚本格式特征

| 元素 | 特征 |
|------|------|
| 场景标题 | `○` 开头，如：`○ 教室・昼` |
| 人物/动作 | 人名后接动作描写，格式较自由 |
| 台词 | 人名在前，对白紧跟（标记式，非缩进式） |
| 特殊标记 | `SE`（音効）、`M`（音楽）、`N`（ナレーション）、`○`（场景切换） |
| 排印 | 横排为主（现代），明朝体/ゴシック体 |
| 时间约束 | 无严格一页一分钟规则 |

### 4.4 分镜脚本视图（架构决策）

**关键设计**：分镜脚本是**同一份剧本数据的另一种渲染视图**，不是独立模块。

| 传统做法 | LumenX 做法 |
|---------|------------|
| 分镜是另一个文件 | 分镜是同一份数据的表格视图 |
| 写完剧本 → 手动拆分镜 | AI 自动生成分镜建议 → 用户在分镜视图微调 |
| 分镜和剧本脱节 | 修改剧本 → 分镜自动更新（双向绑定） |

分镜视图展示列：镜号 | 景别 | 画面描述 | 台词 | 音效 | 预估时长 | 管线状态（已生成视频？）

### 4.5 用户旅程验证

1. 创作者用**中文短剧格式**（极简模式）快速写完剧本
2. LumenX 自动七维派生 → 喂入视频管线
3. 切换**分镜视图** → 微调镜头/确认 AI 建议
4. 如需外部交付 → 一键切换好莱坞/中文电影格式导出 PDF/FDX

---

## 5. 文档数据模型

### 5.1 设计原则

| 原则 | 说明 |
|------|------|
| Scene 是第一公民 | 场景是所有下游操作的最小调度单位（生成资产/视频都按场景） |
| 类型即语义 | 每种格式元素是独立 Node Type，不是"带样式的段落" |
| Attrs 承载结构化数据 | 节点属性存机器可读信息（正则解析固化，零 AI 成本） |
| 管线状态嵌入 | ShotBlock 携带视频管线状态 |
| 格式无关 | 数据模型不包含任何排版信息，排版由格式层（CSS class）负责 |

### 5.2 完整 Schema 定义

```typescript
// ═══════════════════════════════════════════
// 顶层文档结构
// ═══════════════════════════════════════════

Doc {
  content: "scriptMeta (section | scene)+"  // 元信息 + 幕/场景
}

ScriptMeta {
  attrs: {
    title: string              // 剧本标题
    author: string             // 作者
    contact: string            // 联系方式（选填）
    draftDate: string          // 稿件日期
    format: "hollywood" | "chinese_film" | "chinese_short" | "japanese_anime"
    rendering: "latin" | "cjk_zh" | "cjk_ja"
    revision: number           // 修订版本号
  }
  content: "paragraph*"        // 封面页备注（选填）
}

// ═══════════════════════════════════════════
// 结构组织
// ═══════════════════════════════════════════

Section {
  // 幕/章节标记（长篇电影三幕结构，短剧可选使用）
  attrs: {
    title: string              // "第一幕" / "ACT ONE"
    level: 1 | 2 | 3          // 幕 > 序列 > 段落
  }
  content: "scene+"
}

// ═══════════════════════════════════════════
// 场景（核心结构单元）
// ═══════════════════════════════════════════

Scene {
  attrs: {
    id: string                 // UUID，管线引用锚点
    number: number | null      // 场景编号（可自动递增）
    intExt: "INT" | "EXT" | "INT/EXT" | null
    location: string | null    // 正则解析固化
    timeOfDay: string | null   // 正则解析固化
    synopsis: string | null    // 场景梗概（用户选填或 AI 生成）
    color: string | null       // 场景标记色（用户自定义分类）
  }
  content: "sceneHeading scriptBlock+"
  // scriptBlock = Action | CharacterCue | Dialogue | Parenthetical |
  //              DualDialogue | Transition | ShotBlock | Note | PageBreak
}

// ═══════════════════════════════════════════
// 场景内内容块
// ═══════════════════════════════════════════

SceneHeading {
  content: "text*"             // "INT. 办公室 - 日" 纯文本
}

Action {
  attrs: {
    centered: boolean          // 是否居中动作（好莱坞格式特有）
  }
  content: "text*"
}

CharacterCue {
  attrs: {
    characterId: string | null // 关联到角色数据库（AI 自动匹配 + 用户手动修正）
    extension: string | null   // (V.O.) / (O.S.) / (CONT'D)
  }
  content: "text*"            // 角色名文本
}

Dialogue {
  content: "text*"
}

Parenthetical {
  content: "text*"            // "(微笑着)"
}

DualDialogue {
  content: "dialogueColumn dialogueColumn"
}

DialogueColumn {
  content: "characterCue dialogue parenthetical*"
}

Transition {
  attrs: {
    type: "CUT_TO" | "FADE_IN" | "FADE_OUT" | "DISSOLVE" | "SMASH_CUT" | "custom"
  }
  content: "text*"
}

// ═══════════════════════════════════════════
// 分镜/管线节点
// ═══════════════════════════════════════════

ShotBlock {
  attrs: {
    id: string                 // UUID
    shotNumber: number | null  // 镜号
    shotType: "WS" | "MS" | "CU" | "ECU" | "OTS" | "POV" | "custom" | null
    cameraMovement: string | null  // "PAN LEFT" / "DOLLY IN" / "CRANE UP"
    duration: number | null    // 预估秒数
    pipelineStatus: "suggested" | "reviewing" | "confirmed" | "queued" | "generating" | "done" | "failed"
    videoTaskId: string | null // 关联视频管线任务 ID
    thumbnailUrl: string | null // 生成后的缩略图
  }
  content: "text*"            // 画面描述文本
}

// ═══════════════════════════════════════════
// 辅助节点
// ═══════════════════════════════════════════

Note {
  attrs: {
    author: string | null
    timestamp: string | null
    resolved: boolean
  }
  content: "text*"
}

PageBreak {
  // 强制分页（叶节点，无 content）
}
```

### 5.3 Marks（内联标记）

| Mark | 用途 |
|------|------|
| Bold | Action 中强调 |
| Italic | 内心描写/声音 |
| Underline | 标题强调 |
| Strikethrough | 修订对比 |
| NoteInline | 行内批注高亮，关联 Note 节点 |

### 5.4 七维派生映射

| 维度 | 提取方式 | AI 成本 |
|------|---------|--------|
| 场景 | 遍历 Scene 节点 | 零 |
| 人物 | 遍历 CharacterCue → characterId 去重 | 零（已固化） |
| 地点 | 读取 Scene.attrs.location | 零（正则固化） |
| 道具 | AI 分析 Action 文本 | LLM |
| 节拍 | AI 分析场景叙事节奏 | LLM |
| 分镜 | ShotBlock 节点（AI 建议 + 用户微调） | LLM（初次生成） |
| 时长 | ShotBlock.attrs.duration 累加 | 零 |

### 5.5 人物去重策略

**机制：AI 自动匹配 + 用户手动修正**

1. 用户输入 CharacterCue → 系统自动与已有人物库匹配（文本相似度 + LLM 判断）
2. 首次出现的角色名 → 自动创建新人物条目
3. 疑似别名（如"老王"="王经理"）→ AI 建议合并，用户确认或驳回
4. 用户可随时在人物面板手动合并/拆分

### 5.6 FDX 映射

| FDX Element | LumenX Node | 说明 |
|-------------|-------------|------|
| `<SceneHeading>` | Scene + SceneHeading | FDX 没有 Scene 容器，导入时自动分组 |
| `<Action>` | Action | 1:1 |
| `<Character>` | CharacterCue | 1:1 |
| `<Dialogue>` | Dialogue | 1:1 |
| `<Parenthetical>` | Parenthetical | 1:1 |
| `<Transition>` | Transition | 1:1 |
| `<DualDialogue>` | DualDialogue | 1:1 |
| `<SceneProperties>` | Scene.attrs | 属性映射 |

### 5.7 Fountain 映射

| Fountain 语法 | LumenX Node |
|--------------|-------------|
| `INT. LOCATION - TIME` | Scene + SceneHeading |
| 普通段落 | Action |
| 全大写行（后跟对白） | CharacterCue |
| 缩进行 | Dialogue |
| `(括号内容)` | Parenthetical |
| `> TRANSITION:` | Transition |
| `===` | PageBreak |
| `[[批注]]` | Note |
| `# ACT ONE` | Section |

---

## 6. 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07-03 | 核心定位 = B+A+C | B 为差异化，A/C 为 table stakes |
| 2026-07-03 | Phase 1 范围锁定 7 项 | 最小可用专业编辑器 |
| 2026-07-03 | 编辑器内核 = Tiptap | 验证可行 + 扩展性 + 协作预留 |
| 2026-07-03 | 格式架构 = 二维正交 | 超越 Laper 的 CJK 二元切换 |
| 2026-07-03 | 日本动画格式纳入 P1 | 服务日系漫剧用户 |
| 2026-07-03 | 分镜 = 视图非模块 | 数据复用，双向绑定 |
| 2026-07-03 | 文档数据模型确定 | Scene为核心 + ShotBlock纳入 + 正则解析attrs |
| 2026-07-03 | Section 节点保留 | 短剧可选使用，长片必须 |
| 2026-07-03 | 人物去重 = AI自动+手动修正 | 自动匹配为主，用户可随时介入修正 |
| 2026-07-03 | 编辑器交互 = 混合模式 | 自动识别 + Tab循环 + @呼出 + Slash命令 |
| 2026-07-03 | 角色输入 = @呼出为主 + 冒号触发 + Tab兼容 | 与 LumenX 视频生成流程一致的 @ 交互 |
| 2026-07-03 | 右侧栏 = 6标签分两组 | 创作数据(人/地/道) + 生产管线(镜/线/注) |
| 2026-07-03 | 布局 = 三栏 + 双模式 | 全屏编辑器 + Pipeline嵌入，同一组件两套密度 |
| 2026-07-03 | 分镜视图纳入 Phase 1 | 基础版：缩略图网格 + 状态徽章 + 拖拽排序 |
| 2026-07-03 | 数据流 = 实时增量同步 | 写作过程持续投喂，非“写完才导入” |
| 2026-07-03 | 双路径提取 = L1+L2+L3 | 结构化优先 + 启发式推断 + LLM兜底 |
| 2026-07-03 | ShotBlock 需用户确认 | 只有 confirmed 状态才进入生成队列 |
| 2026-07-03 | 永不惩罚自由格式 | 短剧用户不严格对应格式时 LLM 兜底保证体验 |
| 2026-07-03 | 导出 = 混合架构 | 文本格式前端(FDX/Fountain/TXT)，排版格式后端(PDF/DOCX) |
| 2026-07-03 | PDF精度 = Phase 1 "看起来不错" | 后续按行业标准精度优化 |
| 2026-07-03 | 导入支持纯文本智能格式化 | 复用 L2 启发式规则，粘贴即可识别结构 |
| 2026-07-03 | 版本快照纳入 Phase 1 | 自动快照 + 列表 + 一键恢复，diff对比延后 |
| 2026-07-03 | 存储 = 分离架构 | document.json 为源头，按项目分目录，支撑快照+高频保存 |
| 2026-07-03 | 双入口架构 | Studio独立入口 + Pipeline嵌入，同组件双密度，先写后决定无门槛 |
| 2026-07-03 | WGA 合规原则 | AI 功能必须可选/透明/可关闭，不自动替换内容 |
| 2026-07-03 | 故事连贯性 Phase分期 | P1.4 基础版(角色出场统计+消失警告)，P2 完整版(LLM弧光诊断) |
| 2026-07-03 | 大文档性能 = 场景折叠 | 30场以上自动启用，可见节点从3000降至200-500 |
| 2026-07-03 | 错误恢复 = 本地优先 | 任何后台失败不影响写作流，编辑器始终可用 |

---

## 7. 编辑器布局设计

### 7.1 总体布局（三栏结构）

```
┌─────────────────────────────────────────────────────────────────────┐
│ [顶部工具栏 · 48px]                                                 │
│ 项目名 › | 格式▾ | 🪄AI | ↩︎↪︎ | 视图▾ | 导出▾ | 👤                  │
├──────────┬────────────────────────────────────────┬─────────────────┤
│ 左侧栏    │          主编辑区                       │   右侧栏         │
│ 260px    │        (Tiptap · flex-1)              │   320px          │
│ 可折叠→40px│                                       │   可折叠→40px     │
├──────────┴────────────────────────────────────────┴─────────────────┤
│ [底部状态栏 · 32px]                                                 │
│  📄 页数 | 🎬 场景数 | ⏱ 预估时长 | ✏️ 字数 | 💾 保存状态            │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 左侧栏：结构导航（260px）

| 区块 | 内容 | 交互 |
|------|------|------|
| **大纲**（可折叠） | Section/幕结构树 | 拖拽重组 |
| **场景列表**（常驻） | Scene 编号+标题+颜色标记 | 点击跳转、拖拽排序、右键菜单 |
| **书签/待办** | 用户标记 + TODO 批注收集 | 点击跳转 |
| **搜索**（底部固定） | 全文搜索 + 人物/地点过滤 | 即时高亮 |

- 折叠状态：变为 40px 纯图标栏
- 场景卡片右键：复制/删除/添加书签/生成分镜

### 7.3 右侧栏：数据库+管线（320px · 六标签分两组）

**图标栏布局（垂直）**：

```
┌─────────────┐
│ 📂 创作数据  │
│  👤 人物     │  角色卡片网格，点击展开详情，触发画像生成
│  📍 地点     │  地点列表 + 关联场景，触发概念图生成
│  🎁 道具     │  AI提取道具清单，触发道具概念图
│ ─ ─ ─ ─ ─  │
│ 🔧 生产管线  │
│  🎬 分镜     │  当前场景 ShotBlock 缩略图，状态徽章
│  ⚡ 管线     │  全项目进度仪表盘，任务队列，批量生成
│  💬 批注     │  Note 聚合列表，按人/时间/状态过滤
└─────────────┘
```

**智能自动切换**（可锁定 🔒）：

| 光标位置 | 自动切换到 |
|---------|------------|
| CharacterCue / Dialogue | 👤 人物 |
| SceneHeading | 📍 地点 |
| ShotBlock | 🎬 分镜 |
| Note | 💬 批注 |
| 其他 | 保持上次 |

### 7.4 顶部工具栏（48px）

| 位置 | 元素 | 说明 |
|------|------|------|
| 左 | 面包屑 | 项目名 › 当前场景 |
| 中左 | 格式切换 | 下拉：格式 × 渲染 二维矩阵选择 |
| 中 | AI 工具 | 拆分镜/提道具/生梗概/续写/润色 |
| 中右 | 撤销/重做 | ↩︎↪︎ |
| 右 | 视图切换 | 编辑/分镜/阅读/全屏专注 |
| 最右 | 导出 | FDX/Fountain/PDF/DOCX/TXT |

### 7.5 底部状态栏（32px）

常驻显示七维派生的数字摘要：页数 | 场景数 | 预估时长 | 字数 | 保存状态

### 7.6 视图模式

| 视图 | 说明 | Phase |
|------|------|-------|
| **编辑视图** | 完整三栏，日常写作 | Phase 1 |
| **分镜视图** | ShotBlock 卡片网格，拖拽排序，状态徽章 | Phase 1（基础版） |
| **阅读视图** | 只读，精确排版预览，接近 PDF 效果 | Phase 1 |
| **全屏专注** | 隐藏所有面板，仅编辑区 + 悬浮迷你工具栏 | Phase 1 |

### 7.7 双模式适配

| 模式 | 路由 | 布局差异 |
|------|------|----------|
| **全屏编辑器** | `/studio/editor` | 完整三栏 + 全部面板 |
| **Pipeline 嵌入** | `/studio/project/{id}` | 隐藏左侧栏，右侧栏仅保留分镜+管线，顶栏精简 |
| **全屏专注** | 任意模式内触发 | 隐藏所有栏 |

同一 React 组件，通过 `mode: 'full' | 'embedded' | 'focus'` prop 控制密度。

### 7.8 导航层级与双入口架构

**更新后的 LumenX 导航结构**：

```
LumenX
├── Studio
│   ├── 项目列表
│   │   └── 项目 → [Script Editor 嵌入] → ArtDirection → Storyboard → Video → Export
│   └── 📝 Script Editor（全屏独立入口）
└── Playground
```

**双入口设计原则**：

| 场景 | 入口 | 行为 |
|------|------|------|
| “先写再决定” | Script Editor 独立入口 | 新建空白剧本 / 打开已有项目剧本 |
| “在项目里改” | Pipeline 内嵌入 | 精简版，点“展开”进入全屏 |
| 写完想生成视频 | 独立编辑器内 | 点击“进入管线”→ 自动创建/关联项目 → 跳转 Pipeline |
| 数据 | 两个入口共享 | 同一份 document.json，零重复 |

**第一性原理判断**：
- 用户灵感来了就应该能立刻写字，不应被迫先“创建项目”
- 写完后进入管线应是无缝衔接，不是“导入”
- 同一组件双入口 = 开发成本几乎不增加，用户体验大幅提升

### 7.9 与 Laper 对标结论

| 维度 | Laper | LumenX |
|------|-------|--------|
| 结构化数据库 | 场/人/地 | 场/人/地/道/镜/线/注 (七维) |
| CJK 切换 | 二元开关 | 二维正交（格式 × 渲染） |
| AI 队列 | 单向队列 | 全景管线仪表盘 |
| 分镜生成 | 图片 | 图片 + 视频（管线一体化） |
| 多格式 | 好莱坞+CJK | 好莱坞+中文电影+中文短剧+日本动画 |
| 视图 | 未知 | 编辑/分镜/阅读/专注 四视图 |
| 系列感知 | 无 | ReconcileModal 跨集资产合并 |

**结论：功能维度只胜不输。**

---

## 8. 编辑器→管线数据流设计

### 8.1 设计原则

- **实时增量同步**：写作过程中持续向管线投喂结构化数据
- **永不惩罚自由格式**：无论用户是专业编剧还是短剧创作者，都能获得完整派生数据
- **ShotBlock 需用户确认**：只有确认状态的分镜才进入视频生成队列

### 8.2 双路径提取架构

用户输入质量光谱：
```
[高结构化] ←──────────────────→ [纯自由文本]
 专业编剧       中间态        短剧创作者/粘贴文本

    ↓               ↓               ↓
 零成本提取     混合提取       LLM 全量提取
```

| 层级 | 触发条件 | 提取方式 | 延迟 | AI 成本 |
|------|---------|---------|------|--------|
| **L1 结构化提取** | 文档中有明确 Node Type | 遍历 AST | 实时 | 零 |
| **L2 启发式推断** | 文本含半结构化模式 | 正则 + 规则引擎 | 实时 | 零 |
| **L3 LLM 兜底** | L1+L2 覆盖不足 (confidence < 0.7) | 后端 Qwen 增量补全 | 异步 2-5s | LLM token |

### 8.3 L2 启发式规则

| 规则 | 检测模式 | 动作 |
|------|---------|------|
| 冒号对白 | `人名：对白` 或 `人名:对白` | 建议拆分 CharacterCue+Dialogue |
| 场景标记 | "内景"/"外景"/"INT"/"EXT" 开头 | 建议转为 SceneHeading |
| 括号动作 | `（动作描写）` 在对白前 | 建议转为 Parenthetical |
| 转场词 | "切至"/"淡入"/"CUT TO" | 建议转为 Transition |
| 日式场景 | `○` 开头 | 建议转为 SceneHeading（日本动画） |

交互：文本下方出现淡蓝色提示条——"检测到可格式化内容 → 一键格式化 | 忽略"

### 8.4 LLM 兜底设计

- **增量补全**：发送已提取结果 + 缺口标记 + 原始文本块，LLM 只补缺不重复
- **智能重构建议**：LLM 可建议把纯文本拆分为结构化节点，用户确认后执行
- **成本控制**：仅当 confidence < 0.7 时触发，且只发未覆盖部分

### 8.5 ShotBlock 生命周期

```
[💡 suggested] → [👁️ reviewing] → [✅ confirmed] → [⚡ queued] → [🎬 done]
                       ↓                                        ↓
                 [❌ rejected]                              [🔴 failed]
                       ↓                                        ↓
                 重新编辑 → [💡 suggested]               重试 → [⚡ queued]
```

- 只有 `confirmed` 状态进入视频生成队列
- 确认后修改画面描述 → 状态回退到 `reviewing`
- 支持批量确认（管线面板“全部确认”按钮）

### 8.6 同步触发策略

| 事件 | 前端动作 | 后端动作 |
|------|---------|----------|
| 文档变化 (debounce 500ms) | 更新 L1 派生 + 评估 confidence | — |
| confidence < 0.7 + 停止输入 2s | — | 触发 L3 LLM 增量补全 |
| 自动保存 (30s) | 推送 document_json + 派生数据 | 持久化 + 差异对比 |
| Cmd+S | 同上 + 触发完整 AI 派生 | 道具/节拍/分镜建议更新 |
| ShotBlock 确认 | 更新状态为 confirmed | 进入视频生成队列 |

### 8.7 API 设计变化

新编辑器直接给后端结构化数据，跳过 LLM 解析步骤（当 confidence 足够时）：

```
// 新 API：接收结构化数据
POST /projects/{id}/sync_derivation
body: {
  scenes: [...],          // 前端 L1 提取
  characters: [...],      // 前端 L1 提取
  locations: [...],       // 前端 L1 提取
  confidence_score: 0.85, // 覆盖率
  document_json: {...}    // Tiptap JSON（备用）
}

// 兜底 API：请求 LLM 增量补全
POST /projects/{id}/derive_gaps
body: {
  already_extracted: {...},  // 已有结果
  gaps: ["characters_incomplete", "props_missing"],
  raw_text_blocks: [...]     // 未结构化的文本块
}
```

---

## 9. 导出与导入系统

### 9.1 导出架构（混合模式）

| 格式 | 位置 | 实现方式 | Phase 1 精度 |
|------|------|---------|----------|
| **FDX** | 前端 | Tiptap JSON → XML 序列化 | 行业标准 |
| **Fountain** | 前端 | Tiptap JSON → 文本标记序列化 | 行业标准 |
| **TXT** | 前端 | 纯文本输出 | 完整 |
| **PDF** | 后端 | ReportLab/WeasyPrint 生成 | “看起来不错”，后续优化至行业标准 |
| **DOCX** | 后端 | python-docx 样式模板 | 可用 |

前端导出：Tiptap JSON → 遍历 AST → 按目标格式规则输出字符串/XML

后端导出 API：
```
POST /projects/{id}/export
body: {
  format: "pdf" | "docx",
  document_json: {...},
  options: {
    page_size: "letter" | "a4",
    format_style: "hollywood" | "chinese_film" | "chinese_short" | "japanese_anime"
  }
}
response: { download_url: "..." }
```

### 9.2 导入支持

| 导入源 | 实现方式 | 后续处理 |
|--------|---------|----------|
| **FDX 文件** | 前端解析 XML → Tiptap JSON | 自动分组场景 + 正则解析 attrs + 人物去重 |
| **Fountain 文件** | 前端解析标记语法 → Tiptap JSON | 同上 |
| **纯文本粘贴** | L2 启发式规则识别结构 | 提示条引导用户确认格式化 |

### 9.3 FDX 导入增强逻辑

FDX 没有 Scene 容器，导入后自动补全：
1. 按 SceneHeading 分组为 Scene 节点
2. 正则解析 intExt / location / timeOfDay
3. 触发人物去重（AI自动 + 用户确认）
4. 标记为“已导入，待确认”状态

### 9.4 纯文本智能格式化（复用 L2）

用户粘贴纯文本时：
1. 内容进入 Action 节点
2. L2 启发式规则扫描文本模式
3. 检测到对白/场景头/转场等模式 → 显示淡蓝色提示条
4. 用户点击“一键格式化”→ 自动拆分为结构化节点
5. 拆分不完整时 → 触发 L3 LLM 补全

---

## 10. 持久化与状态管理

### 10.1 存储架构（分离式）

```
~/.tron/comic/
├── projects.json                    ← 项目索引（轻量，仅 id/标题/时间）
└── projects/
    └── {project-id}/
        ├── document.json            ← Tiptap 文档（编辑器核心，唯一源头）
        ├── metadata.json            ← 项目设置/艺术方向/模型配置
        ├── derivation.json          ← 七维派生缓存（可重建）
        └── history/                 ← 版本快照
            ├── 1720000000.json
            └── ...
```

**设计原则**：
- `document.json` 是唯一源头（single source of truth）
- `metadata.json` 和 `derivation.json` 是可重建的派生物
- 不一致时 → 从 document.json 重新派生
- 写入策略：先写临时文件 → rename（原子操作）

### 10.2 自动保存策略

| 触发 | 动作 | 快照 |
|------|------|------|
| 文档变化 + 30s debounce | 保存 document.json | 不创建快照 |
| Cmd+S 手动保存 | 保存 document.json | 创建快照 |
| 关闭编辑器/切换项目 | 保存 document.json | 创建快照 |
| 每 10 分钟定时 | — | 创建快照（如有变化） |

**快照清理策略**：保留最近 50 个或 7 天，取其大者。

### 10.3 版本快照 UI（Phase 1 基础版）

- 工具栏 “历史” 按钮 → 弹出时间线列表
- 每个快照显示：时间 + 场景数变化 + 字数变化
- 点击“恢复”→ 替换当前文档（替换前自动创建一个“恢复前”快照）
- Phase 1.5：diff 对比视图

### 10.4 前端状态管理（Zustand）

```typescript
interface EditorStore {
  // 编辑器实例
  editor: Editor | null
  
  // 文档状态
  isDirty: boolean
  lastSavedAt: Date | null
  
  // 格式状态（二维正交）
  currentFormat: 'hollywood' | 'chinese_film' | 'chinese_short' | 'japanese_anime'
  currentRendering: 'latin' | 'cjk_zh' | 'cjk_ja'
  
  // 视图与模式
  viewMode: 'edit' | 'storyboard' | 'read' | 'focus'
  editorMode: 'full' | 'embedded' | 'focus'
  activeRightPanel: 'characters' | 'locations' | 'props' | 'shots' | 'pipeline' | 'notes' | null
  leftSidebarCollapsed: boolean
  rightSidebarCollapsed: boolean
  
  // 派生数据（L1 实时更新）
  derivedScenes: Scene[]
  derivedCharacters: Character[]
  derivedLocations: string[]
  estimatedDuration: number
  confidenceScore: number
  
  // 管线状态
  shotBlocks: ShotBlock[]
  pipelineQueue: PipelineTask[]
  
  // 操作
  save(): Promise<void>
  exportTo(format: string): Promise<string>
  importFrom(file: File): Promise<void>
  restoreSnapshot(timestamp: number): Promise<void>
  switchFormat(format: string, rendering: string): void
  switchView(mode: string): void
}
```

### 10.5 与现有系统兼容

- 现有 `projects.json` 保持为索引，增加 `storage_version` 字段
- 旧项目首次打开时自动迁移到新目录结构
- IndexedDB 作为前端离线缓存，网络恢复后同步

### 10.6 保存与同步边界澄清

| 事件 | 前端动作 | 后端动作 | 说明 |
|------|---------|----------|------|
| 文档变化 (debounce 500ms) | 更新 L1 派生 + 评估 confidence | — | 仅前端内存状态 |
| 自动保存 (30s) | 写入 document.json + 推送派生数据 | 持久化 derivation.json | **保存 = 落盘 + 同步派生** |
| Cmd+S | 同上 + 创建快照 | 同上 + 触发完整 AI 派生 | **手动 = 保存 + 快照 + AI** |
| confidence < 0.7 + 停止输入 2s | 发送补全请求 | L3 LLM 增量补全 | **兜底 = 异步不阻塞** |

简言之：前端 L1 是实时的（500ms），落盘是 30s 周期的，LLM 是条件触发的。三者独立不耦合。

### 10.7 大文档性能策略

**问题本质**：

Tiptap/ProseMirror 的渲染模型是：文档 JSON → 完整 DOM 树 → 浏览器布局计算 → 屏幕像素。
200 页剧本 ≈ 3000 个 Node → 3000 个 DOM 元素，浏览器同时维护所有元素的布局/事件/重绘 → 卡顿。

**第一性原理：用户在任一时刻看多少内容？**

```
屏幕高度 ≈ 900px（扣除顶栏+底栏）
一个场景平均 ≈ 300-500px
用户视口内 ≈ 2-3 个场景

→ 用户任一时刻只在看 2-3 个场景
→ 其余 97% 的 DOM 元素是“在场但不被注视”的
```

**解法空间与排除过程**：

| 方案 | 原理 | DOM 减少量 | 破坏什么 |
|------|------|----------|----------|
| A. 虚拟滚动 | 只渲染视口内节点 | ~95% | ProseMirror 位置映射、Cmd+F、光标连续性、undo |
| **B. 场景折叠** | 非聚焦场景折叠为 1 行 | ~90% | 无（用户可控行为） |
| C. 分片加载 | 按场景分文件，只加载当前片 | ~95% | 全文搜索、拖拽、统计、L1派生 |
| D. 懒渲染 | 首屏渲染前 N 场，滚动触发后续 | ~60% | 滚动到远端仍卡 |

**排除 A（虚拟滚动）**：
- ProseMirror 内核假设所有节点都在 DOM 中（position mapping 依赖连续 DOM 偏移量）
- 强行虚拟化 = 重写视图层 = 相当于自研编辑器，违反“编辑器是已解决问题”的第一性原则
- Cmd+F 浏览器原生搜索失效（视口外节点不在 DOM 中）

**排除 C（分片加载）**：
- 打破“一份 document.json = 唯一源头”的存储架构决策
- 跨场景拖拽、全文统计、L1 实时派生都需要完整文档在内存中

**排除 D（懒渲染）**：
- 只解决首屏加载，不解决编辑中性能（前 49 场已在 DOM 中）

**为什么 B（场景折叠）是最优解——从编剧注意力模型出发**：

```
编剧写作时的注意力分布：
├── 当前场景：100% 注意力（在写/在改）
├── 上一场景：偶尔回看上文（上下文参考）
├── 下一场景：偶尔预览下文
└── 其余场景：几乎不看，只在跳转时才需要
```

这个注意力模型天然匹配“折叠”——把用户不看的东西从 DOM 中移除，且用户对此有认知（因为他本来就不在看那些场景）。

**关键优势**：
1. 不破坏任何 ProseMirror 内部机制——折叠只是 CSS + 摘要行替代
2. 左侧栏场景列表提供即时跳转，折叠不影响导航效率
3. 全文统计/L1 派生仍在完整 JSON 上运行——折叠只影响 DOM 渲染层
4. 实现成本极低（Scene 节点加 `collapsed` 属性 + CSS 控制）
5. 用户可随时 Cmd+Shift+E 全展开（短剧本无需折叠）

**唯一代价**：Cmd+F 浏览器原生搜索无法搜到折叠场景内的文本。但左侧栏已有自定义搜索功能（搜索完整文档并跳转展开）。

**决策：场景折叠（Phase 1） + 虚拟滚动预留（Phase 2）**

**实现方式**：
- 默认：当前场景 + 上下各 1 场展开，其余折叠为单行摘要
- 点击折叠场景的摘要行 → 展开该场景，先前的自动折叠
- 左侧栏点击场景 → 展开并滚动到该场景
- Cmd+Shift+E 切换“全部展开/智能折叠”
- 阈值：文档超过 30 场时自动启用智能折叠，少于 30 场全展开

---

## 11. Phase 1 实现路线图

### 11.1 排序原则

1. **地基先行** — 后续功能依赖的基础必须最先
2. **尽早验证核心假设** — B（管线联动）应尽早跑通最小闭环
3. **用户价值递增** — 每个阶段结束都是可用状态

### 11.2 实现阶段

#### Phase 1.0：地基

| 任务 | 依赖 | 说明 |
|------|------|------|
| Tiptap 编辑器初始化 | 无 | 基础 Node Extensions（Doc/ScriptMeta/Scene/SceneHeading/Action/CharacterCue/Dialogue/Parenthetical/Transition/ShotBlock/Note/PageBreak/DualDialogue/Section） |
| 分离式存储架构 | 无 | projects目录结构 + document.json + 自动保存 + 旧项目迁移 |
| 三栏布局骨架 | 无 | 左260px + 中flex-1 + 右320px + 顶48px + 底32px，可折叠 |
| Zustand EditorStore | Tiptap | isDirty/lastSavedAt/save()/基础状态 |
| 双模式适配 | 布局 | mode prop: full/embedded/focus |

**里程碑 M1**：打开编辑器 → 写内容 → 保存 → 重新打开还在

#### Phase 1.1：格式引擎

| 任务 | 依赖 | 说明 |
|------|------|------|
| 好莱坞格式排版 | 1.0 | Courier 12pt、精确缩进、CSS分页模拟 |
| 中文短剧格式 | 1.0 | 顶格角色名+冒号、无缩进规则、CJK字体 |
| 二维正交格式切换 | 好莱坞+短剧 | 格式×渲染矩阵选择器，顶栏下拉 |
| 混合输入模式 | 1.0 | InputRule自动识别 + Tab循环 + @呼出角色 + Slash命令 |
| @呼出角色列表 | 混合输入 | 角色库下拉 + 创建新角色 + characterId关联 |
| 冒号触发（中文短剧） | 混合输入 | “角色名：”自动拆分为 CharacterCue+Dialogue |
| L2 启发式规则 | InputRule | 纯文本模式检测 + 淡蓝提示条 + 一键格式化 |
| 场景标题正则解析 | 1.0 | intExt/location/timeOfDay 自动固化到 Scene.attrs |

**里程碑 M2**：好莱坞/短剧格式排版正确，@呼出角色，Tab切换，看起来像专业剧本编辑器

#### Phase 1.2：管线联动（差异化验证点）

| 任务 | 依赖 | 说明 |
|------|------|------|
| L1 实时派生引擎 | 1.1 | 遍历 AST 提取场景/人物/地点/时长，debounce 500ms |
| confidence 评估系统 | L1 | 计算覆盖率，决定是否触发 L3 |
| 右侧栏：人物面板 | 1.0布局 | 角色卡片网格 + 详情 + 触发画像生成 |
| 右侧栏：分镜面板 | 1.0布局 | ShotBlock 缩略图 + 状态徽章 |
| ShotBlock 确认流程 | 1.1 ShotBlock | suggested→reviewing→confirmed→queued→done |
| `sync_derivation` API | L1引擎 | 前端推送结构化数据到后端 |
| `derive_gaps` API | sync API | L3 LLM 兜底增量补全 |
| 后端管线对接 | sync API | 接收结构化数据 → 跳过解析 → 直接进入资产/视频生成 |
| 人物去重 | L1 + 人物面板 | AI自动匹配 + 用户手动修正 |
| 右侧栏智能自动切换 | 右侧栏面板 | 光标位置→自动切换对应标签，可锁定 |

**里程碑 M3**：写剧本 → 实时提取 → ShotBlock → 确认 → 视频生成（最小闭环跑通）

#### Phase 1.3：专业补全

| 任务 | 依赖 | 说明 |
|------|------|------|
| FDX 导入 | 1.1 | XML解析 → Tiptap JSON + 自动分组场景 + 解析attrs + 去重 |
| FDX 导出 | 1.1 | Tiptap JSON → FDX XML 序列化 |
| Fountain 导入 | 1.1 | 标记语法解析 → Tiptap JSON |
| Fountain 导出 | 1.1 | Tiptap JSON → Fountain 文本 |
| TXT 导出 | 1.1 | 纯文本序列化 |
| PDF 后端导出 | sync API | ReportLab/WeasyPrint，“看起来不错”精度 |
| DOCX 后端导出 | sync API | python-docx 样式模板 |
| 中文电影格式 | 二维正交 | 高格式另一套排版规则 |
| 日本动画格式 | 二维正交 | ○场景头 + SE/M/N标记 + CJK日文渲染 |
| 右侧栏：地点面板 | 1.2 | 地点列表 + 关联场景 + 触发概念图 |
| 右侧栏：道具面板 | 1.2 | AI提取道具清单 + 触发概念图 |
| 右侧栏：管线仪表盘 | 1.2 | 全项目进度 + 任务队列 + 批量生成 |
| 右侧栏：批注面板 | 1.0 | Note节点聚合 + 过滤 + 点击跳转 |

**里程碑 M4**：FDX 互操作 + PDF导出 + 四种格式完整 + 右侧栏六标签全就位

#### Phase 1.4：体验打磨

| 任务 | 依赖 | 说明 |
|------|------|------|
| 版本快照 + 历史面板 | 存储架构 | 自动快照 + 时间线列表 + 一键恢复 |
| 分镜视图 | ShotBlock | 卡片网格 + 拖拽排序 + 状态徽章 + 点击跳转 |
| 阅读视图 | 格式引擎 | 只读 + 精确排版预览 |
| 全屏专注模式 | 布局 | 隐藏所有面板 + 悬浮迷你工具栏 |
| 左侧栏：大纲视图 | 1.0 | Section/幕结构树 + 拖拽重组 |
| 左侧栏：场景列表完整 | 1.0 | 颜色标记 + 拖拽排序 + 右键菜单 |
| 左侧栏：搜索 + 书签 | 1.0 | 全文搜索 + 人物/地点过滤 + 书签管理 |
| 底部状态栏 | L1引擎 | 页数/场景数/时长/字数/保存状态 |
| 顶栏 AI 工具菜单 | L1 + L3 | 拆分镜/提道具/生梗概/续写/润色 |
| IndexedDB 离线缓存 | 存储架构 | 前端离线写入 + 网络恢复同步 |
| 场景折叠（大文档性能） | 1.0 | 30场以上自动启用 + Cmd+Shift+E 切换 |
| 角色弧光基础版 | L1引擎 | 出场统计 + 消失警告 + 地点复用统计 |
| 键盘快捷键体系 | 全局 | Tab/Cmd+Enter/@/Slash + 视图切换 + 侧栏折叠 |

**里程碑 M5**：Phase 1 Done — 完整专业剧本编辑器，功能只胜不输 Laper，管线联动独一无二

### 11.3 关键里程碑总览

| 里程碑 | 标志 |
|--------|------|
| **M1：能写** | 打开编辑器 → 写内容 → 保存 → 重新打开还在 |
| **M2：像剧本** | 好莱坞/短剧格式排版正确，@呼出，Tab切换 |
| **M3：通管线** | 写剧本→实时提取→ShotBlock→确认→视频生成 |
| **M4：可交付** | FDX互操作 + PDF导出 + 四格式 + 六标签 |
| **M5：精品** | 版本快照 + 分镜视图 + 统计 + AI工具 |

---

## 12. 补充设计决策

### 12.1 WGA 合规与 AI 透明性原则

> 来源：调研报告 §6.5 WGA 政策立场

**设计约束**：所有 AI 功能必须是**可选、透明、可关闭**的辅助工具。

| 原则 | 实现 |
|------|------|
| **可选** | 所有 AI 操作需用户主动触发（点击按钮/确认弹窗），不自动替换用户内容 |
| **透明** | AI 生成的内容带淡紫色背景标记，直到用户确认接受 |
| **可关闭** | 设置中可全局关闭 AI 功能，编辑器仍完整可用 |
| **不强制** | LLM 兜底的“建议格式化”“建议拆分镜”均为建议，用户可忽略 |

### 12.2 故事连贯性追踪（角色弧光基础版）

> 来源：调研报告 §6.2 — 96% 编剧的首要痛点是“叙事连贯性差”
> 参考：FinalBit AI 的“Persistent Story Memory”概念

**Phase 1.4 基础版**（零 LLM 成本，纯 L1 派生）：

| 功能 | 实现 | 位置 |
|------|------|------|
| 角色出场统计 | 遍历 CharacterCue → 每个角色出现在哪些场景 | 右侧栏人物面板详情 |
| 角色“消失”警告 | 角色在前 5 场活跃，但后 10 场未出现 → 提示 | 底部状态栏或批注 |
| 场景时间线 | Scene 按序排列 + timeOfDay 展示 | 左侧栏场景列表 |
| 地点复用统计 | 哪些地点只出现 1 次（可能是资源浪费） | 右侧栏地点面板 |

**Phase 2 完整版**（LLM 驱动）：
- 角色弧光诊断（角色情绪变化是否合理）
- 情节漏洞检测（埋下的伏笔未回收）
- 跨集连贯性（系列剧场景）

### 12.3 错误恢复策略

| 场景 | 表现 | 恢复策略 |
|------|------|----------|
| 保存失败 | 底部状态栏红色警告 + 重试按钮 | 3 次重试后提示导出到本地 |
| LLM 调用失败 | 静默失败，不影响写作流 | 状态栏显示“AI 服务暂不可用”，手动重试按钮 |
| 网络断开 | 编辑器完全可用（本地保存） | IndexedDB 缓存，网络恢复后自动同步 |
| 文档损坏 | 打开时检测 JSON 解析失败 | 自动加载最近快照 + 提示用户 |
| ShotBlock 生成失败 | 状态变为 `failed` | 显示失败原因 + “重试”按钮 |

**核心原则**：任何后台服务失败都不应影响用户当前的写作流。编辑器是“本地优先”的。

### 12.4 键盘快捷键体系

| 快捷键 | 动作 | 兼容 |
|---------|------|------|
| `Tab` | 循环切换节点类型 (Action→Character→Dialogue→...) | Final Draft 兼容 |
| `Enter` | 当前节点类型下新建下一行 | 标准 |
| `Cmd+Enter` | 新建场景 | 自定义 |
| `Cmd+S` | 手动保存 + 快照 | 标准 |
| `Cmd+Z` / `Cmd+Shift+Z` | 撤销/重做 | 标准 |
| `Cmd+Shift+E` | 切换智能折叠/全展开 | 自定义 |
| `@` | 呼出角色列表 | LumenX 特有 |
| `/` | Slash 命令菜单 | Notion/Tiptap 通用 |
| `Cmd+\` | 折叠/展开左侧栏 | VS Code 兼容 |
| `Cmd+B` | 折叠/展开右侧栏 | 自定义 |
| `Cmd+Shift+F` | 全屏专注模式 | 自定义 |
| `Cmd+1/2/3/4` | 切换视图（编辑/分镜/阅读/专注） | 自定义 |

### 12.5 “进入管线”流程设计

用户在独立编辑器写完剧本后，点击“进入管线”按钮：

```
用户点击“进入管线”
    │
    ├─ 已关联项目？→ 直接跳转 /studio/project/{id}
    │
    └─ 未关联项目？
        ├─ 显示弹窗：“创建新项目” / “关联已有项目”
        ├─ 创建新项目：自动用剧本标题命名 + 同步派生数据
        └─ 关联已有：展示项目列表，选择后替换该项目的剧本
```

### 12.6 右侧栏智能自动切换（实现策略）

已在 §7.3 设计，补充实现细节：

```typescript
// 监听光标位置变化
editor.on('selectionUpdate', ({ editor }) => {
  const node = editor.state.selection.$from.parent
  if (rightPanelLocked) return  // 用户锁定时不自动切换
  
  switch (node.type.name) {
    case 'characterCue':
    case 'dialogue':
      setActiveRightPanel('characters')
      break
    case 'sceneHeading':
      setActiveRightPanel('locations')
      break
    case 'shotBlock':
      setActiveRightPanel('shots')
      break
    case 'note':
      setActiveRightPanel('notes')
      break
  }
})
```

��入 **Phase 1.2** 实现（依赖右侧栏面板完成）。

---

## Part B: 实现蓝图（Implementation Blueprint）

> 以下章节为交付给实现 Agent 的具体执行规格。Part A 回答"做什么、为什么"，Part B 回答"怎么做、放哪里"。

---

## 13. 前端目录结构

### 13.1 新增文件布局

```
frontend/src/
├── components/
│   └── modules/
│       └── ScriptEditor/                    ← 新增：剧本编辑器模块根目录
│           ├── index.tsx                    ← 模块导出 + 入口组件
│           ├── ScriptEditorShell.tsx        ← 三栏布局壳（left + center + right）
│           ├── extensions/                  ← Tiptap Node/Mark Extensions
│           │   ├── index.ts                ← 汇总导出所有 extensions
│           │   ├── SceneHeading.ts         ← 场景标题节点
│           │   ├── Action.ts              ← 动作描述节点
│           │   ├── CharacterCue.ts        ← 角色提示节点
│           │   ├── Dialogue.ts            ← 台词节点
│           │   ├── Parenthetical.ts       ← 导演指示节点
│           │   ├── Transition.ts          ← 转场节点
│           │   ├── ShotBlock.ts           ← 分镜块节点（Phase 1 数据占位）
│           │   ├── DualDialogue.ts        ← 对白双栏节点
│           │   ├── Note.ts               ← 注释节点
│           │   ├── Section.ts            ← 幕/章节可选结构节点
│           │   └── SceneFolding.ts       ← 场景折叠交互逻辑
│           ├── panels/                      ← 右侧栏面板组
│           │   ├── CharacterPanel.tsx      ← 角色列表 + @引用
│           │   ├── LocationPanel.tsx       ← 地点/场景列表
│           │   ├── ShotPanel.tsx          ← ShotBlock 管理
│           │   ├── PipelinePanel.tsx       ← "进入管线" 入口
│           │   └── NotesPanel.tsx         ← 注释/备忘
│           ├── sidebar/                     ← 左侧栏
│           │   ├── SceneNavigator.tsx      ← 场景列表导航
│           │   ├── OutlineView.tsx        ← 大纲视图
│           │   └── SearchPanel.tsx        ← 全文搜索
│           ├── toolbar/                     ← 顶部工具栏
│           │   ├── FormatToolbar.tsx       ← 格式切换 + 渲染模式
│           │   └── EditorStatusBar.tsx    ← 底部状态栏（字数/时长/confidence）
│           ├── dialogs/                     ← 模态框
│           │   ├── ImportDialog.tsx        ← 导入 FDX/PDF/TXT
│           │   ├── ExportDialog.tsx        ← 导出 FDX/PDF/TXT
│           │   ├── SnapshotListDialog.tsx  ← 版本快照列表 + 恢复
│           │   └── PipelineLinkDialog.tsx  ← 关联/创建项目
│           └── hooks/                       ← 编辑器专用 hooks
│               ├── useEditorSetup.ts       ← Editor 初始化 + 销毁
│               ├── useAutoSave.ts         ← 自动保存 + 快照逻辑
│               ├── useDerivation.ts       ← L1/L2/L3 七维派生
│               ├── useFormatEngine.ts     ← 格式切换 + 渲染映射
│               ├── usePasteHandler.ts     ← 纯文本粘贴智能格式化
│               └── useSceneFolding.ts     ← 场景折叠状态管理
├── store/
│   └── editorStore.ts                       ← 新增：EditorStore（§10.4 定义）
└── lib/
    └── scriptEditorApi.ts                   ← 新增：剧本编辑器专用 API 客户端
```

### 13.2 设计原则

- **模块自治**：ScriptEditor 作为 `components/modules/` 下的独立模块，与现有 StoryboardComposer、Cast 等模块平级
- **Extension 即节点**：每个剧本格式元素对应一个 Tiptap Extension 文件
- **Hook 即逻辑**：业务逻辑抽离到 hooks/，组件只负责 UI 渲染
- **Store 独立**：editorStore 独立于 projectStore，通过 projectId 关联

---

## 14. 依赖清单

### 14.1 新增 npm 依赖（安装到 frontend/）

```bash
# 核心编辑器
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit

# 必需 Extensions
npm install @tiptap/extension-placeholder
npm install @tiptap/extension-character-count
npm install @tiptap/extension-history
npm install @tiptap/extension-dropcursor
npm install @tiptap/extension-gapcursor

# 可选 Extensions（按需启用）
npm install @tiptap/extension-collaboration      # Phase 2 协作预留
npm install @tiptap/extension-mention             # @ 角色引用
npm install @tiptap/extension-typography          # 智能引号/破折号
```

### 14.2 无需安装（已在项目中）

| 包 | 用途 |
|---|------|
| zustand 5.x | EditorStore 状态管理 |
| framer-motion | 面板切换动画 |
| lucide-react | 工具栏图标 |
| axios | API 请求 |
| next-intl | 国际化 |

### 14.3 后端无新增依赖

剧本编辑器后端 API 使用现有 FastAPI + Pydantic 栈，无需新增 Python 包。

---

## 15. 后端 API 契约

### 15.1 新增端点一览

> 所有端点挂载在现有 `src/apps/comic_gen/api.py` 的 `app` 对象上。
> 遵循现有 `def`（同步）惯例，除非有 `await` 才用 `async def`。

| 方法 | 路径 | 说明 | Phase |
|------|------|------|-------|
| `POST` | `/projects/{id}/document` | 保存 Tiptap JSON 文档 | 1.0 |
| `GET` | `/projects/{id}/document` | 加载文档（返回 Tiptap JSON） | 1.0 |
| `GET` | `/projects/{id}/document/snapshots` | 列出版本快照 | 1.0 |
| `POST` | `/projects/{id}/document/snapshots` | 创建快照 | 1.0 |
| `POST` | `/projects/{id}/document/snapshots/{ts}/restore` | 恢复到指定快照 | 1.0 |
| `POST` | `/projects/{id}/document/derive` | 触发完整 AI 派生（L3） | 1.2 |
| `POST` | `/projects/{id}/document/import` | 导入 FDX/PDF/TXT → Tiptap JSON | 1.1 |
| `POST` | `/projects/{id}/document/export` | 导出为 FDX/PDF/TXT | 1.1 |

### 15.2 详细契约

#### `POST /projects/{id}/document`

保存编辑器文档到持久化存储。

```python
# Request Body
class SaveDocumentRequest(BaseModel):
    content: dict          # Tiptap JSON document
    create_snapshot: bool = False  # 是否同时创建快照

# Response 200
{
    "saved_at": 1720000000.0,
    "snapshot_created": false,
    "derivation_stale": true   # 提示前端是否需要重新派生
}
```

#### `GET /projects/{id}/document`

加载文档。如果项目还没有 document.json（旧项目），从 `original_text` 自动迁移。

```python
# Response 200
{
    "content": { ... },           # Tiptap JSON（可直接 editor.commands.setContent()）
    "last_saved_at": 1720000000.0,
    "format": "hollywood",
    "rendering": "latin",
    "derivation": {               # 最新派生缓存（可能 stale）
        "scenes": [...],
        "characters": [...],
        "locations": [...],
        "estimated_duration": 120,
        "confidence_score": 0.85,
        "shot_blocks": [...],
        "pipeline_queue": [...]
    }
}

# Response 404 — 项目不存在
```

#### `GET /projects/{id}/document/snapshots`

```python
# Response 200
{
    "snapshots": [
        { "timestamp": 1720000000, "label": "auto", "size_bytes": 45000 },
        { "timestamp": 1720003600, "label": "manual", "size_bytes": 46000 }
    ]
}
```

#### `POST /projects/{id}/document/snapshots/{ts}/restore`

```python
# Response 200 — 返回恢复后的完整文档（同 GET /document 格式）
# Response 404 — 快照不存在
```

#### `POST /projects/{id}/document/import`

```python
# Request: multipart/form-data
#   file: File (FDX/PDF/TXT/Fountain)
#   format_hint: Optional[str]  # 强制指定源格式

# Response 200
{
    "content": { ... },          # 转换后的 Tiptap JSON
    "detected_format": "fdx",
    "warnings": []               # 转换中丢失的信息提示
}
```

#### `POST /projects/{id}/document/export`

```python
# Request Body
class ExportDocumentRequest(BaseModel):
    format: str           # "fdx" | "pdf" | "txt" | "fountain"
    content: dict         # 当前 Tiptap JSON（前端传入最新版本）

# Response 200 — 返回文件 (Content-Disposition: attachment)
```

### 15.3 存储实现

后端在现有 `~/.tron/comic/projects/{project-id}/` 目录下操作：

```python
# 保存
def save_document(project_id: str, content: dict, create_snapshot: bool):
    project_dir = os.path.join(DATA_DIR, "projects", project_id)
    os.makedirs(project_dir, exist_ok=True)
    
    doc_path = os.path.join(project_dir, "document.json")
    with open(doc_path, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False)
    
    if create_snapshot:
        history_dir = os.path.join(project_dir, "history")
        os.makedirs(history_dir, exist_ok=True)
        snapshot_path = os.path.join(history_dir, f"{int(time.time())}.json")
        shutil.copy2(doc_path, snapshot_path)
```

---

## 16. React 组件拆分与职责

### 16.1 组件层级图

```
ScriptEditorShell                    ← 三栏布局容器
├── sidebar/ (左栏, 可折叠)
│   ├── SceneNavigator              ← 场景列表 + 点击跳转
│   ├── OutlineView                 ← 大纲缩略
│   └── SearchPanel                 ← 全文搜索 + 替换
├── center (编辑区)
│   ├── FormatToolbar               ← 格式/视图/渲染切换
│   ├── TiptapEditor                ← @tiptap/react EditorContent
│   └── EditorStatusBar             ← 字数 | 时长 | confidence | 保存状态
└── panels/ (右栏, 可折叠)
    ├── CharacterPanel              ← 角色列表 + @引用 + 语音
    ├── LocationPanel               ← 地点列表 + 出场统计
    ├── ShotPanel                   ← ShotBlock 管理
    ├── PipelinePanel               ← 进入管线 CTA
    └── NotesPanel                  ← 编剧注释
```

### 16.2 各组件职责边界

| 组件 | 职责 | 数据来源 | 对外事件 |
|------|------|---------|----------|
| **ScriptEditorShell** | 三栏布局 + 响应式折叠 | editorStore.leftSidebarCollapsed / rightSidebarCollapsed | — |
| **TiptapEditor** | 挂载 Editor 实例 + Extensions | useEditorSetup hook | selectionUpdate, update |
| **FormatToolbar** | 格式切换按钮组 | editorStore.currentFormat / currentRendering | switchFormat() |
| **SceneNavigator** | 从 derivedScenes 渲染列表 | editorStore.derivedScenes | scrollToScene(id) |
| **CharacterPanel** | 显示角色 + @呼出 | editorStore.derivedCharacters | insertCharacterCue(name) |
| **ShotPanel** | ShotBlock 生命周期管理 | editorStore.shotBlocks | updateShotStatus(id, status) |
| **EditorStatusBar** | 显示统计信息 | editorStore（字数/时长/confidence/isDirty） | — |
| **PipelinePanel** | 展示关联项目 + 跳转 | projectStore.currentProject | navigateToPipeline(id) |

### 16.3 Hook 职责分工

| Hook | 职责 | 触发时机 |
|------|------|------|
| `useEditorSetup` | 创建 Editor 实例，注册所有 Extensions，绑定 update/selectionUpdate 回调 | 组件 mount |
| `useAutoSave` | 30s 周期保存 + Cmd+S 手动保存 + 快照创建 + beforeunload 拦截 | editor.update |
| `useDerivation` | 监听文档变化，debounce 500ms 后运行 L1 派生（场景/角色/时长提取） | editor.update |
| `useFormatEngine` | 管理 format×rendering 二维状态，切换时更新 CSS 变量 + Extension 行为 | 用户操作 |
| `usePasteHandler` | 拦截粘贴事件，识别格式 → 结构化 → 插入节点 | editor.paste |
| `useSceneFolding` | 管理折叠状态，30 场阈值自动启用，Cmd+Shift+E 全切换 | derivedScenes 变化 |

---

## 17. 各 Milestone 验收标准

### Milestone 1.0 — 地基可写（Foundation）

| # | 验收项 | 通过标准 |
|---|--------|------|
| 1 | 编辑器渲染 | 打开页面，TiptapEditor 加载并可输入文字 |
| 2 | 节点类型 | 输入文本后，至少可手动切换为 SceneHeading / Action / CharacterCue / Dialogue / Transition 五种节点 |
| 3 | 三栏布局 | 左栏显示场景列表（可折叠），中栏编辑区，右栏面板区（可折叠） |
| 4 | 保存/加载 | Cmd+S 触发保存 → 刷新页面后内容恢复 |
| 5 | 快照 | Cmd+S 后可在快照列表看到记录，点击恢复可回到该版本 |
| 6 | L1 派生 | 输入 SceneHeading 节点后，左栏场景列表自动更新；底部状态栏显示字数/预估时长 |
| 7 | 路由可达 | 通过 `#/studio/editor` 可直接进入独立编辑器；通过项目页的"编辑剧本"可进入嵌入模式 |

### Milestone 1.1 — 格式引擎（Format Engine）

| # | 验收项 | 通过标准 |
|---|--------|------|
| 1 | 格式切换 | 在 FormatToolbar 切换 Hollywood/中国电影/短剧/日本动画 四种格式，编辑器实时响应（节点类型名称/缩进/布局变化） |
| 2 | Tab 键 | 在 Action 节点按 Tab 自动切换到 CharacterCue，再 Tab 切到 Dialogue（符合 Final Draft 惯例） |
| 3 | 粘贴格式化 | 粘贴纯文本剧本片段，自动识别并格式化为对应节点（成功率 > 70%） |
| 4 | 导入 FDX | 上传 .fdx 文件 → 编辑器正确显示所有节点类型 |
| 5 | 导出 FDX | 导出为 .fdx → 用 Final Draft 打开结构正确 |
| 6 | 渲染模式 | 切换 Latin/CJK-ZH/CJK-JA 渲染，排版宽度和断行规则变化 |

### Milestone 1.2 — 管线集成（Pipeline Integration）

| # | 验收项 | 通过标准 |
|---|--------|------|
| 1 | @角色引用 | 在编辑区输入 `@` 弹出角色选择列表，选择后插入 CharacterCue 节点 |
| 2 | 右栏联动 | 光标移入 Dialogue → 右栏自动切到 CharacterPanel；移入 SceneHeading → 切到 LocationPanel |
| 3 | ShotBlock | 可在文档中插入 ShotBlock 节点，状态显示为 suggested，在 ShotPanel 中可见 |
| 4 | 进入管线 | 点击 PipelinePanel 的"进入管线"按钮 → 正确跳转到项目的分镜/视频页面 |
| 5 | 双向导航 | 从项目详情页点"编辑剧本"→ 进入编辑器嵌入模式（带返回按钮） |

### Milestone 1.3 — 专业补全（Professional Completion）

| # | 验收项 | 通过标准 |
|---|--------|------|
| 1 | DualDialogue | 可创建双栏对白，两列独立编辑 |
| 2 | Note 节点 | 可插入不可见于导出的编剧注释 |
| 3 | Section 节点 | 可标记幕/章节，大纲视图正确显示层级 |
| 4 | 键盘快捷键 | §12.4 定义的 12 个快捷键全部可用 |
| 5 | 故事连贯性 | 底部状态栏显示角色出场统计；角色在某场消失后显示警告标记 |

### Milestone 1.4 — 打磨交付（Polish & Ship）

| # | 验收项 | 通过标准 |
|---|--------|------|
| 1 | 场景折叠 | 30+ 场文档自动启用折叠，展开/折叠流畅无闪烁 |
| 2 | 搜索 | 左栏搜索可搜全文（含折叠场景），点击结果自动展开并跳转 |
| 3 | 错误恢复 | 断网状态下编辑 → 恢复网络后自动保存成功 |
| 4 | 性能 | 50 场文档（~1500 节点）编辑时输入延迟 < 50ms |
| 5 | 国际化 | 所有 UI 文本通过 next-intl，中英文切换正常 |

---

## 18. 与现有代码的集成点

### 18.1 路由注册

**文件**：`frontend/src/app/page.tsx`

当前应用使用 hash 路由（`#/project/{id}`, `#/library` 等）。需要新增：

```typescript
// 在现有 hash route switch 中新增：
case 'studio/editor':       // 独立编辑器入口
  return <ScriptEditorShell mode="full" />
case `project/${id}/editor`: // 嵌入式编辑器（从项目详情进入）
  return <ScriptEditorShell mode="embedded" projectId={id} />
```

### 18.2 导航入口

**文件**：`frontend/src/components/layout/GlobalSidebar.tsx`

在全局侧边栏新增"剧本编辑器"图标入口，位于 Workspace 和 Library 之间：

```typescript
{ icon: <PenTool />, label: t('sidebar.editor'), route: '#/studio/editor' }
```

**文件**：项目详情页组件

在项目详情/管线页面顶部新增"编辑剧本"按钮：

```typescript
<Button onClick={() => navigate(`#/project/${projectId}/editor`)}>
  {t('project.editScript')}
</Button>
```

### 18.3 Store 集成

**新增文件**：`frontend/src/store/editorStore.ts`

- 独立于 `projectStore`，通过 `projectId` 字段关联
- 不持久化到 localStorage（文档持久化由后端 API 负责）
- 导出 `useEditorStore` hook

**与 projectStore 交互**：
- 当 editorStore 的 derivedScenes/derivedCharacters 更新时，**不**回写到 projectStore
- 只有"进入管线"时才将派生数据提交到 pipeline（通过 API 调用）

### 18.4 后端集成

**文件**：`src/apps/comic_gen/api.py`

在文件末尾追加新的 endpoint 块（约 150 行），按现有代码风格：

```python
# ============================================================
# Script Editor — Document CRUD & Snapshots
# ============================================================

class SaveDocumentRequest(BaseModel):
    content: dict
    create_snapshot: bool = False

@app.post("/projects/{script_id}/document")
def save_document(script_id: str, request: SaveDocumentRequest):
    ...

@app.get("/projects/{script_id}/document")
def get_document(script_id: str):
    ...
```

**数据目录**：

在现有 `pipeline._save_data()` 之外，document 和 history 使用独立的文件路径：

```
~/.tron/comic/projects/{project-id}/
├── document.json       ← 新增
├── derivation.json     ← 新增
└── history/            ← 新增
    └── {timestamp}.json
```

### 18.5 API 客户端集成

**新增文件**：`frontend/src/lib/scriptEditorApi.ts`

独立于现有 `api.ts`（避免膨胀已 1600+ 行的文件），但使用相同的 `API_URL` 和 axios 模式：

```typescript
import axios from 'axios'
import { API_URL } from './api'

export const scriptEditorApi = {
  saveDocument: (projectId: string, content: object, createSnapshot = false) =>
    axios.post(`${API_URL}/projects/${projectId}/document`, { content, create_snapshot: createSnapshot }),

  loadDocument: (projectId: string) =>
    axios.get(`${API_URL}/projects/${projectId}/document`),

  listSnapshots: (projectId: string) =>
    axios.get(`${API_URL}/projects/${projectId}/document/snapshots`),

  restoreSnapshot: (projectId: string, timestamp: number) =>
    axios.post(`${API_URL}/projects/${projectId}/document/snapshots/${timestamp}/restore`),

  triggerDerivation: (projectId: string) =>
    axios.post(`${API_URL}/projects/${projectId}/document/derive`),

  importFile: (projectId: string, file: File, formatHint?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (formatHint) formData.append('format_hint', formatHint)
    return axios.post(`${API_URL}/projects/${projectId}/document/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },

  exportDocument: (projectId: string, format: string, content: object) =>
    axios.post(`${API_URL}/projects/${projectId}/document/export`, { format, content }, {
      responseType: 'blob'
    }),
}
```

### 18.6 与现有 ScriptProcessor 的关系

现有的 `frontend/src/components/modules/ScriptProcessor.tsx` 是一个简单的 textarea + "提取实体" 按钮。在 Phase 1 完成后：

1. **新建项目流程**：保持 ScriptProcessor 作为快速输入入口（粘贴文本 → 快速创建项目）
2. **编辑流程**：项目创建后，点击"编辑剧本"进入 ScriptEditor（结构化编辑器）
3. **不立即删除 ScriptProcessor**：渐进迁移，Phase 1 完成后评估是否保留或合并

### 18.7 CSS/主题集成

**文件**：`frontend/src/app/globals.css`

新增剧本编辑器专用 CSS 变量块（在现有主题变量后追加）：

```css
/* Script Editor — Format-specific typography */
.script-editor {
  --script-page-width: 8.5in;
  --script-margin-left: 1.5in;
  --script-margin-right: 1in;
  --script-font-size: 12pt;
  --script-line-height: 1;
  --script-font-family: 'Courier Prime', 'Courier New', monospace;
}

.script-editor[data-rendering="cjk_zh"] {
  --script-font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  --script-line-height: 1.6;
}

.script-editor[data-rendering="cjk_ja"] {
  --script-font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic', sans-serif;
  --script-line-height: 1.5;
}
```

---

## 19. 实现顺序总结

```
Phase 1.0 地基（可写可存）
  ├─ 安装 Tiptap 依赖
  ├─ 实现 5 个核心 Extension（SceneHeading/Action/CharacterCue/Dialogue/Transition）
  ├─ 搭建 ScriptEditorShell 三栏骨架
  ├─ 实现 useEditorSetup + useAutoSave
  ├─ 后端 /document CRUD + snapshot 端点
  ├─ editorStore 基础字段
  ├─ 路由注册 + 导航入口
  └─ L1 派生（场景列表 + 字数 + 时长）

Phase 1.1 格式引擎
  ├─ 格式二维矩阵实现（4 format × 3 rendering）
  ├─ Tab 键行为 + Enter 键行为
  ├─ 粘贴处理器（usePasteHandler）
  ├─ 导入/导出端点 + UI
  └─ 剩余 Extension（Parenthetical/Transition/DualDialogue/Note/Section）

Phase 1.2 管线集成
  ├─ @角色引用（Mention Extension）
  ├─ ShotBlock Extension + ShotPanel
  ├─ 右栏智能切换（selectionUpdate 监听）
  ├─ PipelinePanel + 跳转逻辑
  └─ 嵌入模式适配

Phase 1.3 专业补全
  ├─ DualDialogue 双栏实现
  ├─ Section 节点 + 大纲视图
  ├─ 键盘快捷键完整实现
  └─ 故事连贯性基础版

Phase 1.4 打磨交付
  ├─ 场景折叠（useSceneFolding）
  ├─ 全文搜索面板
  ├─ 错误恢复 + 离线容忍
  ├─ 性能验证（50 场 < 50ms）
  └─ 国际化 + 无障碍
```

---

**Part B 完毕。本文档已可交付给实现 Agent 直接执行。**
