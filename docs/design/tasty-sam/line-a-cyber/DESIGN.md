# Line A — Cyber Refined

> Tasty Sam 重构方案 · 延续线 | Omni Studio
> "Render Noise into Narrative" — 在 Cyber Brutalism × Cinematic Restraint 框架内做精做深

---

## 这条线是什么

Line A **不另起炉灶**。它接受 QoderWork 已确立的品牌资产与视觉框架——
电蓝 `#646cff`、霓虹粉 `#ff0080`、深空黑 `#050508`、JetBrains Mono 字标、棱角莲花 logo——
然后在**同一套语言里把执行细节做到位**。

它存在的意义是回答一个问题：*如果不换风格，QoderWork 的方案还能更好吗？*
答案是能。Line A 针对原方案的四个短板逐一补强，且不引入任何新的视觉母题。

## 相对 QoderWork 的四处精修

### 1. Surface 层次：可读的 5 层，而非"到处 glass"
QoderWork 大量使用 `rgba(255,255,255,0.04)` 半透明面板 + backdrop-blur，
导致深色媒体之上的卡片边界模糊、层级塌陷。Line A 改为**实色分层**：

| 层 | Token | 值 | 用途 |
|----|-------|-----|------|
| Base | `--color-bg-base` | `#050508` | 页面最底 |
| Surface | `--color-bg-surface` | `#101013`（实色） | 卡片/面板主体 |
| Elevated | `--color-bg-elevated` | `#161619` | modal / popover |
| Inset | `--color-bg-inset` | `#0a0a0d` | 媒体井、嵌套区 |
| Hover | `--color-bg-hover` | `rgba(255,255,255,0.055)` | 悬停高亮 |

> 玻璃感保留，但只在 **task queue 浮层、lightbox chrome** 等"漂浮于内容之上"的元件使用，
> blur 上限 2px。深度来自光与阴影，不靠雾化。

### 2. CTA 主次：一个明确的主行动
原方案按钮对比度偏平，主次不分。Line A 让**主 CTA 用实心电蓝 + `--glow-primary` 光晕**，
glass / ghost 按钮明确退居二线。每屏只有一个视觉上"最亮"的行动点。

### 3. 完整 motion spec
为每个转场定义 时长 × 曲线 × 编排（见下方 Motion 表）。
ShotCard 展开为 ShotPanel、候选网格 stagger 入场、状态切换、任务队列滑入——
都有确定的动效契约，而非"看情况"。

### 4. 全局态覆盖
default / hover / focus-visible / active / disabled / **loading / empty / error / offline** 全覆盖，
对比度 ≥ 4.5:1，`prefers-reduced-motion` 生效。

---

## Color System

### Seed Layer（与产品家族共享）
| Token | 值 | 角色 |
|-------|-----|------|
| `--seed-bg` | `#050508` | 深空黑底 |
| `--seed-fg` | `#ededed` | 主文本 |
| `--seed-primary` | `#646cff` | Electric blue — CTA / active |
| `--seed-accent` | `#ff0080` | Hot pink — 警示 / 品牌时刻 |
| `--seed-radius` | `8px` | 圆角基准 |

### Status Tokens（OKLCH，5 态）
pending 250(蓝) · processing 80(琥珀) · completed 155(绿) · failed 25(红) · starred 90(金)。
每态携带 `-fg / -border / -bg` 三元组，语义与 QoderWork 一致以保证迁移可读。

## Typography
三字体三档，沿用原体系：

| Tier | Font | 用途 | 特征 |
|------|------|------|------|
| Chrome | JetBrains Mono | section header / badge / 元数据 | UPPERCASE, 0.18em, 10–11px |
| Body | Inter | 输入值 / 描述 / 行内 | 正常字重, 12–13px |
| Display | Space Grotesk | 主 CTA / 焦点标题 | Semibold, 负字距, 14–22px |

## Motion

| 场景 | 时长 | 曲线 | 编排 |
|------|------|------|------|
| hover / focus / toggle | 150ms | ease-out | 即时 |
| ShotCard → ShotPanel 展开 | 250ms | ease-out | 高度+透明度联动，内容延迟 60ms |
| 候选网格入场 | 250ms | ease-expo | stagger 40ms / 项 |
| 任务队列滑入 | 250ms | ease-out | translateX(8px)→0 + fade |
| 状态徽标切换 | 150ms | ease-out | 颜色 crossfade，无位移 |
| modal 打开 | 250ms | ease-expo | scale(0.98)→1 + backdrop fade |

全程尊重 `prefers-reduced-motion: reduce`。

## Spacing & Radius
8px 基准网格：`--space-2xs 4 / xs 8 / sm 12 / md 16 / lg 24 / xl 40 / 2xl 64`。
圆角：`sm 4 / md 8 / lg 12 / xl 16 / pill 999`。

## Signature Element
**"生成中"状态的扫描线呼吸** —— processing 态的媒体井叠加一条极细电蓝扫描线
（`--scanline`）缓慢上下游走，呼应 brutalist 母题，同时是唯一被允许的装饰动效。

## Token 三层推导验证
改 `tokens.css` 中 `--seed-primary` 一处，CTA、active 态、focus ring、glow、scanline 全部联动。

## 文件
- `tokens.css` — 三层 token（seed → semantic → component）
- `*.html` — workspace / storyboard-r2v / pipeline-steps / library / settings / playground / modals
