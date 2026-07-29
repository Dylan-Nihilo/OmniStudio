# LumenX Studio · 多主题系统（可落地）

> Tasty Sam 交付 · 纯设计 + 可落地蓝图，**零侵入**（不改任何现有代码，全部新增于 `docs/design/tasty-sam/theming/`）。
> 把「Warm Bridge vs Full Atelier 二选一」升级为**用户可选的 5 个预设主题**，Full Atelier 默认；换主题时 Logo 一并联动；在三个暗色主题上再加两个亮色主题。

---

## 1. 五个预设主题

| presetId | 名称 | 明暗 | 底色 | 主色 | 强调/选中 | Logo 变体 | 默认 |
|----------|------|------|------|------|-----------|-----------|------|
| `atelier-dark` | Full Atelier | 暗 | 暖石墨 `#0c0b0e` | teal `#34d8c4` | amber `#ffa94d` + halation | teal 化（filter）| ★ |
| `bridge-dark` | Warm Bridge | 暗 | 暖中性 `#0a0a0d` | 蓝 `#646cff` | amber 仅选中 | 原蓝 | |
| `brand-dark` | Brand-True | 暗 | 冷黑 `#050508` | 蓝 `#646cff` | hot pink `#ff0080` | 原蓝 | |
| `atelier-light` | 暖亮 Atelier | 亮 | 暖陶白 `#f6f1e9` | teal deep `#1d9c8d` | amber deep `#e8852b` | 深描边 teal | |
| `brand-light` | 品牌亮色 | 亮 | 复用 `html.light` | 蓝 `#646cff` | — | `LumenX_亮色.png` | |

---

## 2. 文件导览

| 文件 | 作用 |
|------|------|
| [`tokens.css`](./tokens.css) | ★ 可落地。5 个 `data-theme` block，命名对齐现有 `globals.css` |
| [`THEME-TOKENS.md`](./THEME-TOKENS.md) | 主题 token 架构（seed→semantic→component） |
| [`theme-switch-demo.html`](./theme-switch-demo.html) | 5 主题实时切换演示（扁平预设列表 + 同一工作台 DOM 重渲染 + Logo 联动） |
| [`logo-adaptation.html`](./logo-adaptation.html) | Logo × 5 主题联动矩阵 |
| `storyboard-r2v.html` | 定稿①核心分镜工作台（Phase 2） |
| `workspace.html` | 定稿②工作区（Phase 2） |
| `library.html` | 定稿③资产库（Phase 2） |
| `FUNCTION-COVERAGE.md` | 功能承载 checklist — 防为设计阉割功能（Phase 2） |

> 快速验证：浏览器打开 `theme-switch-demo.html`，依次点 5 个预设，确认底色/主色/强调/字体/氛围/Logo 全随之切换。

---

## 3. 落地接线（交给实现方，分 4 步）

现有主题基建已非常干净，新增主题 = **加 token block + 扩 store 枚举**，业务组件零改动。

### 步骤 1 · store 枚举升级 `settingsStore.ts`

```ts
// 现状：export type Theme = 'dark' | 'light';
export type ThemePreset =
  | 'atelier-dark' | 'bridge-dark' | 'brand-dark'
  | 'atelier-light' | 'brand-light';

interface SettingsStore {
  locale: Locale;
  theme: ThemePreset;          // 升级
  setTheme: (t: ThemePreset) => void;
  // ...
}
// 默认值：theme: 'atelier-dark'
```

> 兼容旧值：迁移时把持久化的 `'dark'→'brand-dark'`、`'light'→'brand-light'`（保现有用户观感），或用 zustand persist `migrate`。

### 步骤 2 · globals.css 并入 token block

把 `tokens.css` 的 5 个 block 并入 `globals.css`，选择器从 `:root[data-theme="<id>"]` 改为 `html.<id>`（等价，见 THEME-TOKENS §4）。默认 `:root` 复用 `atelier-dark`。新增变量（`--color-primary`、`--halation`、`--font-display` 等）一并加入。

### 步骤 3 · tailwind.config.ts 主色变量化（唯一须动配置处）

```ts
// 现状（硬编码，主色无法随主题切换）：
primary: "#646cff", secondary: "#535bf2", accent: "#ff0080",
// 改为：
primary: "var(--color-primary)",
secondary: "var(--color-primary-hover)",
accent: "var(--color-accent)",
// 新增 display 字体回退 var(--font-display)
```

### 步骤 4 · Providers + layout 防闪烁脚本 + Logo 组件

```ts
// Providers.tsx：class 列表扩成 5 个
const ALL = ['atelier-dark','bridge-dark','brand-dark','atelier-light','brand-light'];
html.classList.remove(...ALL);
html.classList.add(theme);

// layout.tsx 防闪烁内联脚本：白名单扩成 5 个 preset，默认 'atelier-dark'

// LumenXBranding.tsx（必须改造，详见 logo-adaptation.html）：
//  - src 写死 → 按 preset 切（暗 /LumenX-cybr.png；亮 各自亮色 PNG）
//  - "LUMEN" text-white → text-[color:var(--color-text-primary)]
//  - "X" text-[#646cff] → text-[color:var(--color-primary)]
//  - Studio/slogan text-white/30,/20 → 走 text-secondary/muted token
//  - atelier-dark 加内联 filter: hue-rotate(-64deg) saturate(1.35) brightness(1.08)
```

---

## 4. 关键约束（必读）

- **零侵入**：本目录全部新增，未改任何现有文件。`git status` 仅见 `docs/design/tasty-sam/theming/**`。
- **不阉割功能**：核心三页严格映射后端契约（`src/apps/comic_gen/models.py`）与现有交互；任何「放不下」的功能在 `FUNCTION-COVERAGE.md` 标「需沟通」，绝不自行删减。
- **Logo 资源（已定稿）**：三个亮/暗变体均由暗色 Logo 同形重着色、透明底：`logo-dark.png`（白描边+蓝核心，暗主题；`atelier-dark` 另加 teal filter）、`logo-light-teal.png`（深墨描边+teal 核心，`atelier-light`）、`logo-light.png`（深墨描边+蓝核心，`brand-light`）。旧莲花图 `LumenX_亮色.png` 已弃用。

---

## 5. 谁来落地（建议）

| 角色 | 职责 |
|------|------|
| Tasty Sam | 主题 token 系统、Logo 多变体规则、核心页面视觉/组件规格定稿 |
| 原项目 Agent | 接入真实 Next.js（store/globals.css/tailwind/Providers/layout/Branding 改造、对接后端数据流）|
| 协作验收 | 双方对照 `FUNCTION-COVERAGE.md` 逐项核验，确保视觉不阉割功能 |
