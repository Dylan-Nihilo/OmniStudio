# Tasty Sam · LumenX Studio 前端重构方案

> 与 QoderWork ReDesign **同维度对比**的第二套方案 —— 同时给出 **延续线** 与 **突破线**。
> 全部产出为静态高保真原型，**零侵入**：不改动任何现有代码或原 `docs/design/` 文件。

---

## 这套方案在回答什么

QoderWork 已经在 `docs/design/` 产出了一套严谨的 Cyber Brutalism ReDesign。它好，但有四个明确短板：

1. **mock 全是占位色块** —— 没用真实媒体验证"内容为王"在视频/分镜缩略图下的实际观感；
2. **无响应式** —— 全部 1440px 桌面稿；
3. **动效 / 全局态规范不完整** —— error / empty / loading / offline 覆盖不足；
4. **Playground ↔ Pipeline 资产回流路径缺失**。

Tasty Sam 的方案给你**两个可并排比较的答案**：

| | **Line A — Cyber Refined** | **Line B — Luminous Atelier** |
|---|---|---|
| 定位 | 延续线 · 不换风格把执行做到位 | 突破线 · 我的差异化审美主张 |
| 关系 | "如果不换风格，还能更好吗？" → 能 | "电影工具该不该说电影自己的语言？" → 该 |
| 底色 | 冷黑 `#050508` | 暖深石墨 `#0c0b0e` |
| 强调色 | 电蓝 `#646cff` + 霓虹粉 `#ff0080` | 电影 teal `#34d8c4` ↔ amber `#ffa94d` |
| 字体 | Space Grotesk / Inter / Mono | **Fraunces 衬线** + Space Grotesk |
| 容器 | 实色分层卡片 + 硬边框 | 近无框浮起 + halation 发光 |
| 氛围 | 克制 scanline | 胶片颗粒 + 双角落光晕泄漏 |
| Signature | processing 扫描线呼吸 | 选中 take 的 amber halation |

---

## 怎么对比（推荐路径）

把这三屏在浏览器里**并排打开**，看同一个最复杂界面的三种答案：

```
docs/design/mock-02-storyboard-r2v.html            ← QoderWork 基线
docs/design/tasty-sam/line-a-cyber/storyboard-r2v.html   ← 我的延续线
docs/design/tasty-sam/line-b-atelier/storyboard-r2v.html ← 我的突破线
```

分镜工作台（Storyboard R2V）是整个产品**最复杂、价值最高**的界面——
ShotCard 多状态 + ShotPanel 展开 + 候选网格 + 任务队列。先看这屏，差异最直观。

---

## 目录

```
tasty-sam/
├── README.md                ← 你在这里
├── REFACTOR-STRATEGY.md     ← 重构策略：响应式 / motion / 错误态 / 资产回流 / IA 回应
├── assets/                  ← 双线共用的真实占位媒体（电影 noir 主题）
│   ├── shot-01..05.png      ← 分镜 / 视频帧
│   ├── char-detective.png   ← 角色参考
│   └── scene-skyline.png    ← 场景参考
├── line-a-cyber/
│   ├── DESIGN.md  ·  tokens.css
│   ├── storyboard-r2v.html  ← 核心工作台（已交付）
│   └── workspace / pipeline-steps / library / settings / playground / modals (.html)
└── line-b-atelier/
    ├── DESIGN.md  ·  tokens.css
    ├── storyboard-r2v.html  ← 核心工作台（已交付）
    └── workspace / pipeline-steps / library / settings / playground / modals (.html)
```

## 与后端数据契约对齐

mock 字段严格映射 `src/apps/comic_gen/models.py`，确保设计可落地、非臆造：
- **StoryboardFrame**：shot_size / camera_movement / dialogue / duration / image_asset / workbench_tab_mode (t2i_i2v · direct_r2v) / t2i_selected_index
- **VideoTask**：status (pending/processing/completed/failed) / is_starred / model / generation_mode
- **5 状态色 token**：两条线各自表达，但语义一致（pending/processing/completed/failed/starred）

## 两条线如何取舍

二者并非二选一的对立。务实建议见 `REFACTOR-STRATEGY.md`：
**Line A 可立即落地**（与现有品牌资产 0 冲突）；**Line B 是品牌升级提案**
（若团队认同"电影调色母语"主张，可作为下一阶段视觉演进方向）。
两条线共享同一套 seed→semantic→component token 架构，迁移成本可控。

---

*Tasty Sam · frontend craftsperson · 2026-06-09*
