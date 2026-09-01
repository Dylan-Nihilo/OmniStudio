# REFACTOR-STRATEGY — Tasty Sam

> 重构策略文档：补齐 QoderWork 方案的四个短板，并回应其 IA 审计与重构路线图。
> 范围：Omni Studio 全 Pipeline。零侵入静态原型。

---

## 0. 策略总览

| QoderWork 短板 | Tasty Sam 回应 | 落点 |
|----------------|----------------|------|
| mock 全占位色块 | 用真实电影级媒体填充全部 mock | `assets/` + 所有 `.html` |
| 无响应式 | 三档断点（1440 / 1024 / 768）行为规范 | §2 |
| 动效规范不完整 | 全转场 时长×曲线×编排 契约 | §3 |
| 错误/空/加载态不足 | 全局态矩阵 + 每态 mock 呈现 | §4 |
| Playground↔Pipeline 资产回流缺失 | 双向资产流动路径设计 | §5 |

---

## 1. 双线取舍与迁移路径

### Line A — 立即可落地
- 与现有 `#646cff` / `#ff0080` / JetBrains Mono / 棱角莲花 logo **0 冲突**。
- 仅需把现有 `design-system.css` 的 `--color-bg-surface` 从半透明改为实色分层，
  blur 降到 2px，CTA 加 glow —— 是**演进而非重写**。
- 风险最低，建议作为当前迭代直接采用的基线。

### Line B — 品牌升级提案
- 是一次有主张的视觉跃迁：暖底 + teal↔amber + 衬线 + 近无框。
- 共享同一 token 三层架构，故迁移路径清晰：换 seed 层 5 个色值 + 2 个字体 + atmosphere 层。
- 建议路径：先在 Playground / 营销页等"低风险高表现"区域试点，验证用户反馈后再推全站。

### 共享底座
两条线都遵循 `seed → semantic → component`。组件消费 semantic 层，
故**换线 = 换 seed**，组件代码不动。这是双线能共存的工程前提。

---

## 2. 响应式规范（三档断点）

所有页面按以下断点降级。核心原则：**媒体永远是最后被牺牲的**。

| 断点 | 全局 rail | Pipeline 侧栏 | ShotCard 布局 | 候选网格 |
|------|-----------|---------------|---------------|----------|
| **≥1440 桌面** | 56–60px 常驻 | 224–248px 常驻 | 预览左 + 编辑右（双列） | 4 列 |
| **1024 平板** | 常驻 | 折叠为图标抽屉（hover 展开） | 双列，预览缩至 200px | 3 列 |
| **768 窄屏** | 底部 tab bar | 顶部下拉 step 选择器 | **单列堆叠**：预览在上、编辑在下 | 2 列 |

实现要点（落地时）：
```css
/* ShotCard 768 降级示例 */
@media (max-width: 768px){
  .card-body{flex-direction:column}
  .preview{width:100%}
  .cand-grid{grid-template-columns:repeat(2,1fr)}
}
```
- 触控目标 ≥ 44px；窄屏下 action bar 图标按钮放大。
- ShotPanel 在窄屏改为**全屏抽屉**（bottom sheet），而非内联展开。

---

## 3. Motion Spec（完整动效契约）

两条线共享编排逻辑，仅时长/曲线按各自气质调整。

| 场景 | Line A | Line B | 编排 |
|------|--------|--------|------|
| hover / focus | 150ms ease-out | 160ms ease-out | 即时 |
| 卡片悬停抬升 | 阴影变化 | translateY(-3px) ease-spring | — |
| ShotCard→ShotPanel 展开 | 250ms ease-out | 280ms **ease-spring** | 内容延迟 60ms 入场 |
| 候选网格入场 | stagger 40ms/项 | stagger 50ms/项 ease-spring | 自上而下 |
| 状态徽标切换 | 颜色 crossfade 150ms | 同 | 无位移 |
| modal / lightbox | 250ms scale(.98)→1 | 460ms + bloom 渐显 | backdrop 同步 fade |
| 任务队列滑入 | translateX(8px)→0 | 同 | + fade |

- `ease-spring: cubic-bezier(0.34,1.56,0.64,1)` —— Line B 专用，赋予"浮起"重量感。
- **全局**：尊重 `prefers-reduced-motion: reduce`（两条 tokens.css + 每个 mock 均已实现）。

---

## 4. 全局态矩阵

每个交互元件必须覆盖以下态。核心工作台 mock 已实地呈现 ✓。

| 元件 | default | hover | focus-visible | active | disabled | loading | empty | error |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Button | ✓ | ✓ | ✓ | ✓ | ✓ | ✓(spinner) | — | — |
| ShotCard | ✓ | ✓ | ✓ | ✓(selected) | — | ✓(processing) | ✓(pending) | ✓(failed) |
| 候选网格 | ✓ | ✓ | ✓ | ✓(starred) | — | ✓(skeleton) | ✓ | ✓ |
| Input/Select | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ |

**额外全局态**（在 modals.html 与 workspace.html 呈现）：
- **Offline**：顶部条 + 操作按钮禁用 + 重连提示。
- **Empty project**：空态金句 + 引导 CTA（Line B 用 Fraunces 衬线金句，强化品牌时刻）。
- **Toast**：success / error / info / warning 四型。
- 对比度全部 ≥ 4.5:1；状态色 OKLCH 在暗底上可读性已校准。

---

## 5. Playground ↔ Pipeline 资产回流

QoderWork 完全没有设计这条路径。Tasty Sam 的方案：

```
              ┌──────────────┐  「保存到资产库」  ┌──────────────┐
  Playground  │ 自由生成台    │ ───────────────→ │  资产库       │
  (freeform)  │ 单图/单视频   │ ←─────────────── │ (Series 共享) │
              └──────────────┘  「载入为起点」    └──────┬───────┘
                                                          │ 「引用为参考」
                                                          ▼
                                                  ┌──────────────┐
                                                  │ Pipeline     │
                                                  │ ShotCard     │
                                                  │ achip 资产引用│
                                                  └──────────────┘
```

- Playground 生成物可一键 **保存到资产库**（带 tag），进入 Series 级共享池。
- 资产库中任意单元可 **引用为参考**（character/scene/prop chip）注入 ShotCard。
- ShotCard 的 achip 点击 → 反向跳转资产库定位该资产（双向可追溯）。
- 对应 `AssetUnit.image_variants[]` + `VideoVariant`（收藏/选择/上传来源）数据模型。

---

## 6. 对 QoderWork IA 审计的回应

针对原 `report-ia-audit.html` 提出的问题：
- **导航层级混乱** → 三级清晰分层：全局 rail（产品级）→ Pipeline 侧栏（项目步骤）→ 工作台内 section。
- **状态可见性不足** → 5 状态色 + 徽标 + 预览叠层三重冗余编码（不只靠颜色）。
- **进度感缺失** → Pipeline 侧栏 step 完成态打勾 + 顶部 eyebrow 步骤编号。

## 7. 验证清单

- [x] 三屏并排可对比（QoderWork / Line A / Line B）
- [x] Token 三层推导：改 seed 主色一处全局联动
- [x] 核心工作台覆盖 5 状态 + hover/focus/disabled/empty/loading
- [x] reduced-motion 生效
- [ ] 全 Pipeline 页面铺开（workspace/pipeline-steps/library/settings/playground/modals）— 进行中
- [x] 零侵入：`git status` 仅新增 `docs/design/tasty-sam/**`

---

*Tasty Sam · 2026-06-09*
