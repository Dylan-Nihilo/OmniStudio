# Line B — Luminous Atelier

> Tasty Sam 重构方案 · 突破线 | Omni Studio
> "Render Noise into Narrative" — 让电影工具说电影自己的视觉母语

---

## 核心主张

一个把文字渲染成影像的工具，它的界面应该说**电影调色的母语**，而不是赛博终端的工程语。

Line B 在三条不可动摇的前提下——**dark-first · 内容为王 · creator cockpit**——
提出一套与 Cyber Brutalism 截然相反的视觉语言。每一处差异都是**刻意的反向选择**：

| 维度 | QoderWork / Line A | **Line B — Luminous Atelier** | 为什么 |
|------|-------------------|------------------------------|--------|
| 底色 | 纯冷黑 `#050508` | 暖深石墨 `#0c0b0e` | 暗房的暖，不是手术台的冷 |
| 强调色 | 电蓝 + 霓虹粉 | **电影级 teal `#34d8c4` ↔ amber `#ffa94d` 互补** | teal-orange 是调色师的母语，天然契合视频 |
| 字体 | 全等宽 / 几何无衬线 | **高对比衬线 Fraunces** 焦点 + Space Grotesk 正文 | 作者感、工坊感，而非终端感 |
| 容器 | 棱角硬边框 + 网格 | **近无框浮起卡片**，媒体微弱 halation 发光 | chrome 退入暗背景，媒体"漂浮" |
| 节奏 | 中等偏紧凑、强对比 | 更大留白、非对称基线、画廊呼吸感 | 让创作物被"陈列"，而非被"塞满" |
| 氛围层 | scanlines / grid | **极细胶片颗粒 + 光晕泄漏** | 影像的物质感 |

> 主张依据：teal↔orange 是百年电影调色的母语，暖深底是暗房的母语。
> 对一个"把噪声渲染成叙事"的工具，这套语言比冷硬赛博终端**更贴合内容本身**，
> 也更能让用户感到自己在一个 **craft studio** 里，而非控制台前。

---

## Color System

### Seed Layer
| Token | 值 | 角色 |
|-------|-----|------|
| `--seed-bg` | `#0c0b0e` | 暖深石墨底 |
| `--seed-fg` | `#f2ede4` | 暖骨白文本 |
| `--seed-teal` | `#34d8c4` | 阴影 / 冷调强调（主行动） |
| `--seed-amber` | `#ffa94d` | 高光 / 暖调强调（选中） |
| `--seed-rose` | `#ff6b6b` | 警示 / 品牌时刻 |
| `--seed-radius` | `14px` | 更柔的圆角基准 |

**互补色分工**：teal = 主行动 / 完成态（冷，可信）；amber = 选中 take / 生成中（暖，活跃）。
二者构成调色台式的冷暖对话，永不平均分配——一屏只有一处暖高光抓眼。

### Status Tokens（OKLCH，暖调微调）
pending 250(冷蓝) · processing 75(琥珀) · completed 180(teal) · failed 22(暖红) · starred 85(暖金)。
注意 completed 用 teal、processing 用 amber——状态色直接复用品牌冷暖体系。

## Typography
**衬线焦点 + 无衬线正文**的编辑式搭配：

| Tier | Font | 用途 | 特征 |
|------|------|------|------|
| Display | Fraunces (serif) | 焦点标题 / 项目名 / 空态金句 | 高对比, 负字距 -0.02em, 24–48px |
| Body | Space Grotesk | 描述 / 输入 / 行内 | 行高 1.6, 编辑式留白 |
| Mono | JetBrains Mono | 仅技术元数据 / 时间码 / 参数 | UPPERCASE chrome |

> 衬线只用于"作者声音"时刻（标题、金句），正文保持人文 grotesque 的清晰。

## Surface & Elevation —— 近无框哲学
分隔来自**光与影**，不来自边框：

| 层 | 值 | 用途 |
|----|-----|------|
| `--shadow-rest` | `0 2px 8px rgba(0,0,0,.40)` + 顶部 1px 高光 | 卡片静息浮起 |
| `--shadow-lift` | `0 12px 40px rgba(0,0,0,.55)` | hover 抬升 |
| `--shadow-float` | `0 28px 80px rgba(0,0,0,.65)` | modal / lightbox |
| `--glow-teal` | 1px teal ring + 24px 弥散 | 主行动 / focus |
| `--glow-amber` | 1px amber ring + 28px 弥散 | 选中 take 高光 |

边框降到 `rgba(255,255,255,0.06)` 的耳语级，仅作极弱轮廓。

## Atmosphere —— Signature Layer
这是 Line B 的灵魂，QoderWork 完全没有的维度：

1. **胶片颗粒** `--grain-opacity: 0.045` —— 全局极细 noise overlay，给暗场物质感
2. **光晕泄漏** `--bloom-teal`（左上冷）+ `--bloom-amber`（右下暖）—— 双角落柔光，构成冷暖景深
3. **媒体 halation** —— 完成态缩略图边缘极弱外发光，模拟胶片高光溢出

> 三者叠加，让界面像**透过取景器看到的暗房**，而非屏幕上的控件。

## Motion
| 场景 | 时长 | 曲线 |
|------|------|------|
| hover / focus | 160ms | ease-out |
| 卡片浮起 / 展开 | 280ms | **ease-spring**（轻微过冲） |
| 候选画廊入场 | 280ms | ease-spring, stagger 50ms |
| modal / lightbox | 460ms | ease-out + bloom 渐显 |

`ease-spring: cubic-bezier(0.34,1.56,0.64,1)` —— 温柔过冲，赋予"浮起"以重量感。
尊重 `prefers-reduced-motion`。

## Spacing & Radius —— 画廊式
4px 基准但更慷慨：`2xs 4 / xs 8 / sm 12 / md 20 / lg 32 / xl 52 / 2xl 84`。
圆角：`sm 8 / md 14 / lg 20 / xl 28 / pill 999`。按钮用 pill 圆角强化"柔软可触"。

## Signature Element
**选中 take 的 amber halation** —— 当用户 star 一条视频，缩略图浮起并被暖金光晕环绕，
像在调色台上被一束暖光点亮。这是整个界面唯一最强的暖色时刻，承载"这一条就是它"的决定感。

## Token 三层推导验证
改 `--seed-teal` 一处 → 主行动、完成态、focus、glow-teal、bloom-teal 全联动；
改 `--seed-amber` → 选中、生成中、starred halation 全联动。

## 文件
- `tokens.css` — 三层 token（seed → semantic → component + atmosphere）
- `*.html` — workspace / storyboard-r2v / pipeline-steps / library / settings / playground / modals
