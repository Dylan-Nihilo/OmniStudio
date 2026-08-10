# THEME-TOKENS — LumenX Studio 主题 Token 架构

> 三层派生：**seed（品牌 DNA）→ semantic（语义角色）→ component（组件级）**。
> 改 seed 一处，整主题随之变化；组件 CSS 永不写死颜色。
> 文件：[`tokens.css`](./tokens.css)

---

## 1. 为什么是三层

| 层 | 职责 | 例子 | 谁来读 |
|----|------|------|--------|
| **seed** | 品牌原色，每主题最少的「源」 | `--seed-primary`, `--seed-base`, `--seed-accent` | 仅 semantic 层引用 |
| **semantic** | 语义角色，与现有 `globals.css` 命名 100% 对齐 | `--color-bg-base`, `--color-primary`, `--color-status-*` | component 层 + 业务 CSS |
| **component** | 组件级别名，便于换肤微调 | `--card-bg`, `--btn-pri-fg`, `--logo-filter` | 具体组件 |

> 业务组件只读 **semantic**（沿用现有变量）与 **component**。换主题 = 换一组 seed→semantic 映射，组件零改动。

---

## 2. 变量清单

### 2.1 与现有 globals.css 完全对齐（直接并入）

```
背景：--color-bg-base / -surface / -elevated / -inset / -input / -hover
玻璃：--color-glass / --color-overlay
边框：--color-border-default / -subtle
文字：--color-text-primary / -secondary / -muted
字体：--font-inter / --font-jetbrains-mono / --font-space-grotesk
状态：--color-status-{pending,processing,completed,failed,starred}-{fg,border,bg}
      --color-status-starred-solid / --color-on-warm
```

状态色沿用 `oklch()` 写法，dark/light 各调 lightness/chroma（亮色更低 L、更高 C，保证白底对比度 ≥4.5:1）。

### 2.2 新增（现有 globals.css 暂无，Line B 氛围所需）

```
品牌：--color-primary / -primary-hover / -accent / -accent-hover / -on-accent
氛围：--halation / --bloom / --grain-op / --glow-primary / --glow-accent
字体：--font-display（Fraunces，Line B 衬线 display）
组件：--card-bg/-border/-radius / --btn-pri-bg/-fg/-glow / --input-bg/-border / --sidebar-bg / --logo-filter
```

> ⚠️ **落地关键**：现有 `tailwind.config.ts` 把 `primary:"#646cff"`、`secondary:"#535bf2"`、`accent:"#ff0080"` 写成**硬编码 hex**（line 26-28）。
> 要让主色随主题切换，须改为 `primary:"var(--color-primary)"` 等。这是唯一需要动 tailwind 配置的点，详见 README「落地接线」。

---

## 3. 五主题派生表

| presetId | seed-base | seed-primary | seed-accent | font-display | logo-filter |
|----------|-----------|--------------|-------------|--------------|-------------|
| `atelier-dark` ★ | `#0c0b0e` | `#34d8c4` teal | `#ffa94d` amber | Fraunces | `hue-rotate(-64deg)…` |
| `bridge-dark` | `#0a0a0d` | `#646cff` 蓝 | `#ffa94d` amber | Space Grotesk | none |
| `brand-dark` | `#050508` | `#646cff` 蓝 | `#ff0080` pink | Space Grotesk | none |
| `atelier-light` | `#f6f1e9` | `#1d9c8d` teal deep | `#e8852b` amber deep | Fraunces | none（深描边 PNG）|
| `brand-light` | `#f8f9fa` | `#646cff` 蓝 | `#ff0080` pink | Space Grotesk | none |

---

## 4. 选择器模型：data-theme ↔ html.class 等价

- **演示稿**：`:root[data-theme="atelier-dark"]{…}`，JS 切 `data-theme` 即换肤。
- **落地**：现有机制是 `<html class="dark|light">`（`Providers.tsx` + `layout.tsx` 防闪烁脚本）。

二者等价，落地时把 5 个 `[data-theme="<id>"]` 选择器替换为 `html.<id>` 即可：

```css
/* 演示 */            /* 落地 */
:root[data-theme="atelier-dark"]  →  html.atelier-dark
:root[data-theme="brand-light"]   →  html.brand-light
```

> 默认主题：`:root` 与 `:root[data-theme="atelier-dark"]` 共用同一 block，保证未设置时即 Full Atelier。

---

## 5. 验证三层是否自洽

打开 `theme-switch-demo.html`，在 DevTools 改某主题的 `--seed-primary` 一处 →
该主题的 `--color-primary`、按钮、候选选中框、glow 应**全部随之变化**。
若有组件不跟随，说明它写死了颜色，需改回引用 semantic 变量。
