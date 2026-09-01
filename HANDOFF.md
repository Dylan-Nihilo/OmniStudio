# Omni Studio 前端重构 — Handoff

> 写给接手的 Claude Code 同学。本文涵盖工作区现状、设计参考（Line A/B mockup）、
> 已完成工作、遗留决策与下一步建议。

---

## 1. 仓库与分支

```
主仓: /path/to/OmniStudio
远端: 只推 github（origin 是废弃 GitLab，别用它）
主分支: feat/multi-theme-system（HEAD 7241393）
```

### 工作树（worktree）

当前开发在独立 worktree 进行，不影响主 checkout：

```
worktree 路径: /path/to/omni-studio-worktree
分支: feat/atelier-pilot-20260611-161001 (HEAD 739dcb8)
基线: feat/multi-theme-system
```

所有代码改动在这个 worktree 分支上。主 checkout 保持干净。

### 开发环境

```
前端 dev:  http://localhost:3009  (worktree frontend, next dev)
后端 API: http://localhost:17177 (uvicorn, cwd=worktree)
```

**注意**：worktree 的 `output/projects.json` 和 `output/series.json` 是**软链**指向主仓的 `output/`：

```bash
output/projects.json -> ../../tron-comic/output/projects.json
output/series.json   -> ../../tron-comic/output/series.json
```

这是本地开发数据修复——别提交软链，接手的同学需要确保自己那边有后端数据可用。

---

## 2. Line A / Line B 设计参考

### 设计哲学分歧

Omni Studio 的视觉重构分为两条完全对立的方向，都基于同一个前提——**dark-first · 内容为王 · creator cockpit**。

### Line A — Cyber Refined（延续线）

**核心主张**：接受 QoderWork 已确立的赛博框架（电蓝 `#646cff`、霓虹粉 `#ff0080`、深空黑 `#050508`），在同一套语言里把执行细节做到位——不另起炉灶，只做精做深。

- **Surface 5 层**：Base(`#050508`) → Surface(`#101013`实色) → Elevated(`#161619`) → Inset(`#0a0a0d`) → Hover(`rgba(255,255,255,0.055)`)
- **Typography**：JetBrains Mono（元数据） / Inter（正文） / Space Grotesk（Display）
- **Motion**：完整 spec（hover 150ms ease-out / ShotCard 展开 250ms / 候选 stagger 40ms）
- **Signature**：扫描线 / 网格背景 / 棱角硬边框

**位置**：`docs/design/tasty-sam/line-a-cyber/`
- `DESIGN.md` — 完整设计说明
- `tokens.css` — seed→semantic→component token
- 7 个 HTML mockup（workspace / storyboard-r2v / pipeline-steps / library / settings / playground / modals）

### Line B — Luminous Atelier（突破线）← **当前主线**

**核心主张**：一个把文字渲染成影像的工具，应该说**电影调色的母语**，而非赛博终端的工程语。

| 维度 | Line A（Cyber） | **Line B（Atelier）** |
|------|----------------|----------------------|
| 底色 | 纯冷黑 `#050508` | **暖深石墨 `#0c0b0e`** |
| 强调色 | 电蓝 + 霓虹粉 | **teal `#34d8c4` ↔ amber `#ffa94d` 互补** |
| 字体 | 几何无衬线 | **Fraunces 衬线**焦点 + Space Grotesk 正文 |
| 容器 | 棱角硬边框 | **近无框浮起卡片**，halation 发光 |
| 节奏 | 紧凑强对比 | 更大留白、画廊呼吸感 |
| 氛围 | scanlines/grid | **胶片颗粒 + 光晕泄漏** |

- **Signature**：胶片颗粒（`--grain-opacity: 0.045`）/ 双角落光晕（`--bloom-teal` 左上 + `--bloom-amber` 右下）/ 媒体 halation 发光
- **状态色**：pending=冷蓝 / processing=琥珀 / completed=teal / failed=暖红 / starred=暖金

**位置**：`docs/design/tasty-sam/line-b-atelier/`
- `DESIGN.md` — 完整设计说明（重点看 "Atmosphere" 和 "Surface & Elevation"）
- `tokens.css` — seed→semantic→component token
- 7 个 HTML mockup（同上）

### 为什么当前走 Line B

用户明确选择了 Line B（Luminous Atelier）作为主线。理由是 teal↔orange 是百年电影调色的母语，暖深底是暗房的母语——对"把噪声渲染成叙事"的工具，这套语言比冷硬赛博终端更贴合内容本身。

---

## 3. 已完成工作

按提交顺序（最新的在前）：

### ① 全局导航导轨（739dcb8）
- w-56 宽栏 → **60px 图标导轨**，释放主面板空间给二级筛选栏
- 图标：LayoutGrid（工作区）/ Layers（主体库）/ Wand2（创作台）/ Settings（设置）
- **VSCode 活动栏式悬停浮出标签**：hover/focus 时从右侧滑出全称标签面板（absolute z-50，零布局抖动）
- 设置齿轮固定左下角（对齐 Line B mockup）
- Branding：顶部仅保留 logo 图标，hover 浮出 "Omni Studio" 全称
- zero-leak 验证通过：atelier-dark teal vs brand-dark blue+grid，无串色

### ② 工作区画廊重建（3a4b253）
- 按系列分组展示（group-h 标题 + 尾线 + 网格）
- ProjectCard 重建为 16:10 缩略图卡（封面 + 状态徽章 + 衬线标题 + hover 播放键）
- 每系列末尾 "新建项目" 虚线卡片
- 日期派生兼容 `created_at`(unix) 和 `createdAt`(ISO)

### ③ 资产库对齐（ebfd215）
- 页面骨架按 Line B 重建（主标题 + 搜索 + 类型 pill-tabs + 系列分组 + 网格）
- 待接入：第二条筛选栏（类型/系列/收藏）

### ④ 设置页 Line B 风格（f14dce7 + c8d167d）
- 面板字体加大、移除硬边框分隔、去冗余标题
- atelier 签名（浮起卡片 + 无框 + 衬线）

### ⑤ atelier 签名试点（e7aaf1d）
- `.atelier-card` 玻璃浮起 + 琥珀 halation
- `.atelier-page-bloom` + `.atelier-page-grain` 页面氛围
- `.atelier-display` Fraunces 衬线
- `.atelier-badge` / `.atelier-group-line` / `.atelier-search-input`

### ⑥ 侧栏品牌修复（cd21c32 + 更早）
- `.atelier-eyebrow-accent` 琥珀色编号
- i18n 新增 key（fromScript / standaloneGroup / 状态文案等）

---

## 4. 设计决策与遗留问题

### 侧栏导航（已决）
- ✅ 60px 图标导轨 + hover 浮出标签
- ✅ 设置齿轮左下角固定
- ✅ 图标选用：LayoutGrid / Layers / Wand2 / Settings

### Branding 与 Slogan（待落实）
窄栏放不下横排字标和整句 Slogan，需要安置在其他语境：

| 资产 | 建议去向 | 状态 |
|------|---------|------|
| **OMNI_STUDIO 字标** | 导轨顶部仅 logo 图标 + hover 浮出全称（已实现） | ✅ |
| **Slogan 全文** | 设置→关于的品牌签名卡（logo + 斜体琥珀标语 + 版本） |  待做 |
| **Slogan Kicker** | 工作区/资产库空态的品牌时刻卡 | ❌ 待做 |

### 资产库筛选栏（待做）
- 需接入第二条筛选栏（类型 / 系列 / 收藏），与 60px 图标导轨并行
- 参考 Line B library.html 的 `.side` 结构

### 设置图标争议
用户曾展示了一张**双齿轮咬合**的截图（像齿轮+小卫星齿轮），但 **Line B 所有四个页面的 mockup 设置图标都是单齿轮**（= lucide `Settings`）。如果用户坚持双齿轮，需要手绘或另寻 SVG，偏离 mockup。

---

## 5. 技术契约

### 零泄漏原则
- 所有 `.atelier-*` 工具类均用 `html.atelier-dark` / `html.atelier-light` 门控
- 非 atelier 主题（bridge-dark / brand-dark / brand-light）零变化
- 图标导轨结构对所有主题统一，视觉身份由 token 自动切换

### 验证命令
```bash
cd frontend && npx tsc --noEmit           # 类型检查
cd frontend && node scripts/check-playground-colors.mjs  # 颜色守卫
# 浏览器验证：http://localhost:3009（dev） + 切换 5 个主题
```

### 颜色守卫规则
- 禁：`[#hex]` 硬编码 + `white/alpha`
- 允许：纯 `text-white`（彩色底上）/ `black/N`（功能遮罩）

---

## 6. 下一步建议

按优先级：

1. **Branding 落地**：设置→关于页做品牌签名卡（logo + 斜体琥珀 Slogan + 版本号）；工作区空态做品牌时刻卡
2. **资产库筛选栏**：接入 60px 导轨 + 二级筛选栏（类型/系列/收藏），验证空间分配
3. **Playground / Modals 对齐 Line B**：逐步迁移剩余页面
4. **设置图标确认**：确认是单齿轮（贴 mockup）还是双齿轮（偏离但用户偏好）

---

## 7. 关键文件路径速查

```
Design docs:    docs/design/tasty-sam/line-b-atelier/  (DESIGN.md + tokens.css + 7 HTML)
                docs/design/tasty-sam/line-a-cyber/     (同上，作为对照参考)
Frontend src:   frontend/src/components/layout/         (GlobalSidebar, AppShell)
                frontend/src/components/settings/       (SettingsPage, SettingsSidebar)
                frontend/src/components/library/        (AssetLibraryPage)
                frontend/src/components/project/        (ProjectCard)
                frontend/src/app/globals.css            (全局 token + atelier 工具类)
                frontend/src/components/common/         (AssetCard, GroupedModelGrid)
i18n:           frontend/messages/{zh,en}.json
Theme tokens:   frontend/src/app/globals.css (:root / html.atelier-* / html.bridge-* ...)
```

---

*Handoff 完毕。祝顺利。*
