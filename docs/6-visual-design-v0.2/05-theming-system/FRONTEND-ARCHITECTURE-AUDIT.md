# FRONTEND-ARCHITECTURE-AUDIT · LumenX Studio 前端架构审计

> **定位**：独立审计文档，**不属于本期换肤范围**。供「换肤 + 后端接线」验收稳定**之后**的下一期前端改造使用。
> **方法**：全部基于真实代码核实（`frontend/src/**`、`next.config.mjs`、`package.json`），逐条带文件路径/行数，非凭印象。
> **作者**：Tasty Sam（前端设计/架构）。**执行建议**：下一期由你方落地，我出方案。

---

## 0. 最重要的前置结论（先读这条）

**本项目是 `output: 'export'` 的纯静态 SPA，打包进 Electron，运行时没有 Node 服务**（`next.config.mjs:8`）。

因此早期「没利用好 Next.js 路由/RSC/SSR」的判断需要**修正**：

- ❌ **SSR / RSC / Server Components / Server Actions / 服务端 `fetch` —— 架构上不可用**。静态导出 + 桌面端本地数据（后端 `:17177`），这些特性没有运行环境，**不该作为改造目标**。
- ✅ 真正的架构债在别处：**hash 路由替代 App Router**、**2300 行 god component**、**5s 轮询全量重渲染**、**整个 `projects[]` 进 localStorage**、**29 props 的 prop-drilling**、**零数据缓存层**。

> 一句话：方向不是「上 SSR」，而是「**在纯静态 SPA 的约束内，把路由、状态、渲染、数据层做干净**」。

---

## 1. 现状速览（核实数据）

| 维度 | 现状 | 来源 |
|------|------|------|
| 路由 | **仅 1 个 `page.tsx`**（855 行），全靠 `window.location.hash` + `hashchange` 手写解析 | `app/page.tsx:561-625` |
| 渲染模式 | 100% 客户端 SPA；唯一 server component 是空壳 `layout.tsx`（29 行）| `app/layout.tsx`、84 个 `"use client"` |
| 构建 | `output:'export'` 静态导出；`distDir` 桌面 `../static`、Docker `out`；`basePath/assetPrefix=/static` | `next.config.mjs:8-19` |
| 类型/Lint | `typescript.ignoreBuildErrors:true` + `eslint.ignoreDuringBuilds:true`（**构建不拦截错误**）| `next.config.mjs:22-25` |
| 数据层 | 全部 axios `api.ts`（1558 行）+ `useEffect`；**无 React Query/SWR/缓存** | `lib/api.ts` |
| 状态 | Zustand；`projectStore` 把**整个 `projects[]`** 持久化进 localStorage `project-storage` | `store/projectStore.ts:641-649` |
| i18n | next-intl，60 文件用 `useTranslations`；messages 在 `frontend/messages/{zh,en}.json` | `Providers.tsx`、`lib/i18n.ts` |
| 图片 | **无 `next/image`**；26 文件用裸 `<img>` + 自定义 `PreviewImage`；`images.unoptimized:true` | `next.config.mjs:28` |

---

## 2. 问题清单（按「风险 × 收益」排序）

### P0 · god component：`StoryboardR2V.tsx` 2300 行
- **现状**：单文件承载 shot CRUD、T2I 生成、视频生成、双轮询、拖拽排序、配音、精修、资产管理、整页渲染。所有 `api.*` 在此（见 HANDOFF §10）。
- **风险**：单点维护地狱；任何改动影响面巨大；后端接线全压在这一个文件。
- **收益**：拆分后接线点清晰、可测试、可并行开发。
- **方向**：抽 `useShotActions`（CRUD+生成）、`useTaskPolling`（轮询）、`usePersistQueue`（防抖写回）三个 hook，组件只管渲染。**不改对外行为**。

### P0 · 5s 轮询触发全量重渲染
- **现状**：两个 `setInterval(5000)`（`StoryboardR2V.tsx:1257`、`:1276`）每跳都 `updateProject` 整个 project，导致整条 shot 列表重渲染。
- **风险**：任务并发多时，每 5 秒全表重排，掉帧、输入卡顿。
- **方向**：①轮询结果做**字段级 diff**，只更新变化的 task；②`ShotCard` 用 `React.memo` + 稳定 callback（`useCallback`/`useEvent`）；③或引入 React Query 管理任务态（见 P1）。

### P1 · 整个 `projects[]` 进 localStorage
- **现状**：`partialize` 持久化全部 projects（含 frames/variants/video_tasks），无上限、无裁剪（`projectStore.ts:641-649`）。
- **风险**：多集 × 多帧 × 多变体可达数 MB，逼近 localStorage 5MB 上限 → 写入失败/启动变慢。
- **方向**：只持久化轻量索引（project id 列表 + 当前 id），重数据按需从后端拉；或迁移 IndexedDB；或 `partialize` 仅留 meta。

### P1 · 无数据缓存/去重层（无 React Query/SWR）
- **现状**：纯 `useEffect + axios`，无缓存、无去重、无失败重试、无乐观更新。
- **风险**：重复请求、轮询与手动刷新打架、状态分散。
- **方向**：引入 **TanStack Query**（与静态导出完全兼容，纯客户端）。轮询交给 `refetchInterval`，天然去重 + 缓存 + 失效。这一步能顺带化解 P0 轮询重渲染。

### P1 · hash 路由 + step 不入 URL
- **现状**：`page.tsx` 手写 hash 路由（`#/project/{id}` 等）；step 是 `useState`（`ProjectClient.tsx:59`），**刷新必回 script**，无法分享「某项目的 Cast 步骤」深链。
- **约束**：静态导出**支持** App Router 的客户端路由 + 动态段（导出时需要 `generateStaticParams` 或保持 hash）。纯桌面端深链价值有限，但「step 入 URL」对体验/调试有实际价值。
- **方向（二选一）**：
  - 轻量：step 写进 hash query（`#/project/{id}?step=cast`），刷新可恢复，改动小。
  - 彻底：迁 App Router + `?step=` searchParams（`useSearchParams`），代价大，桌面端收益一般。**建议先做轻量版**。

### P1 · prop-drilling：`ShotCard` 收 29 个 props（约 20 个 callback）
- **现状**：`ShotCard.tsx:106-152` 收 29 props；`StoryboardR2V.tsx:1916-1976` 内联闭包逐个透传。
- **风险**：callback 每次渲染新建 → 破坏 memo → 加剧 P0 重渲染；签名臃肿难维护。
- **方向**：把 shot 级动作收进 context 或 `useShotActions` 返回的稳定 dispatch；data props 保留，callback 收敛。

### P2 · 构建忽略 TS/ESLint 错误
- **现状**：`ignoreBuildErrors` + `ignoreDuringBuilds` 全开（`next.config.mjs:22-25`）。
- **风险**：类型/规范错误静默进生产，回归靠运气。
- **方向**：先在 CI 跑非阻塞 `tsc --noEmit` + `eslint`，统计存量；清零后再关掉 ignore。**勿一次性打开**（存量可能很多）。

### P2 · 子树无代码分割
- **现状**：页面级有 `next/dynamic`（`page.tsx:16-26`，6 个视图懒加载）；但 `StoryboardR2V` 及全部 `shot-panel/*` 静态打进同一 chunk。
- **方向**：重模态（CompareModal/VideoConfigModal/PromptExpandModal）改 `next/dynamic` 懒加载，首屏更轻。

### P2 · 图片无优化
- **现状**：无 `next/image`；裸 `<img>`；`unoptimized:true`。
- **约束**：静态导出下 `next/image` 优化本就受限，但**懒加载 `loading="lazy"` + 显式宽高防 CLS** 仍可手动做。
- **方向**：`PreviewImage` 统一加 `loading="lazy"` + `decoding="async"` + 尺寸占位。

### P3 · 已知小 bug
- `StoryboardR2V.tsx:2295` 派发的事件名是 `"navigateStep"`，缺 `lumenx:` 前缀，监听方（`ProjectClient.tsx:113`）收的是 `"lumenx:navigateStep"` → **该跳转静默失效**。下一期顺手修。

---

## 3. 与本期工作的关系（为什么要分期）

| | 本期（换肤 + 后端接线）| 下一期（架构改造）|
|---|---|---|
| 改动性质 | 颜色/字体 token 化 + 接口接线 | 组件拆分 + 数据流重构 + 路由 |
| 触碰文件 | CSS/token + `StoryboardR2V` 接线 | **大改 `StoryboardR2V`/`page.tsx`/`projectStore`** |
| 风险 | 低、可独立验证 | 中高、影响数据流 |
| 冲突点 | —— | **与 HANDOFF §11 冻结清单直接冲突** |

**结论：必须分期。** 架构改造会破坏本期刚立下的「接口/数据流冻结契约」(HANDOFF §11)，两期同改同一批 god component，回归无法定位。正确顺序：

```
换肤 + 后端接线  →  稳定验收（功能/视觉/响应式全绿）  →  架构改造（本文档为蓝本）
```

---

## 4. 建议的下一期路线图（增量、每步可回滚）

> 原则：每步独立可验证、可回滚；先立**视觉/行为基线快照**，每步比对零回归。

1. **基础设施先行（零行为变更）**：接入 TanStack Query（不改现有调用，先并存）；CI 加非阻塞 `tsc`/`eslint` 统计存量。
2. **轮询迁移**：把两个 `setInterval` 改为 Query `refetchInterval` + 字段级 diff → 直接缓解 P0 重渲染。
3. **god component 拆 hook**：抽 `useShotActions`/`useTaskPolling`/`usePersistQueue`，`StoryboardR2V` 只渲染。对外行为不变。
4. **prop 收敛 + memo**：`ShotCard` 走 context/稳定 dispatch，加 `React.memo`。
5. **持久化瘦身**：`projectStore.partialize` 只留索引 meta，重数据按需拉/IndexedDB。
6. **路由轻量化**：step 入 hash query，刷新可恢复；修 `navigateStep` 前缀 bug。
7. **分割与图片**：重模态 `next/dynamic`；`PreviewImage` 加 lazy/尺寸占位。
8. **收尾**：存量类型/lint 清零后关闭 `ignoreBuildErrors`。

> 1→2→3 是**收益最高、风险可控**的前三步，体验提升最明显（输入不卡、任务刷新丝滑）。后续按需推进。

---

_本文件仅为审计与建议，不含本期代码改动。落地前以本文档 §3 分期结论 + HANDOFF §11 冻结清单为准。_
