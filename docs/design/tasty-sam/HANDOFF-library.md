  ---
  交接文档 — Omni Studio 资产库 Line B 保真度(续)

  ⚡ 新会话第一件事(最重要)

  工作树有 6 个文件被改、尚未提交(一个 workflow 刚编辑完,我这边工具通道挂了没来得及复核提交)。第一步:

  P=/path/to/omni-studio-worktree
  cd "$P"
  git status --short        # 应看到下列 6 个文件 M/??
  npm --prefix frontend run typecheck      # 权威全量
  npm --prefix frontend run check:colors

  - 若两者都过 → 按下面"提交计划"原子提交(评审模式,不要 push)。
  - 若 typecheck 报错 → 几乎必然是 4 个并发 agent 的跨文件契约残留,优先查:
    - AssetInspectorProps 是否真的加了 sourceId: string + sourceKind: "series"|"project"(诊断里报过 AssetLibraryPage(444) Property 'sourceId' does not
  exist on AssetInspectorProps——大概率是并发中间态,但要确认终态两边对齐)。
    - api.generateAsset(...) 调用签名是否匹配(api.ts:499 签名:generateAsset(scriptId, assetId, assetType, stylePreset, stylePrompt?,
  generationType='all', prompt='', applyStyle=true, negativePrompt='', batchSize=1, modelName?, aspectRatio?))。
    - 未用 import(如 ProjectCard 删 coverGradient 后、AssetLibraryPage 删 ImageIcon 后)。
    - 只修这类 workflow 引入的小问题,别重构别改设计,绿了再提交。

  📦 这次改了什么(资产库 Line B 保真度,6 文件)

  针对用户反馈:抽屉 hero 裁图、滚动条丑、无图资产发灰、命名、删用于分镜、实现生成变体。

  文件: frontend/src/app/globals.css
  改动: 新增 atelier 滚动条(::-webkit-scrollbar 细 10px + 石墨 #292430 thumb 圆角 + border:3px solid transparent;background-clip:padding-box + Firefox
    scrollbar-width:thin)
  提交信息: feat(ui): atelier scrollbar styling (thin graphite thumb)
  ────────────────────────────────────────
  文件: frontend/messages/zh.json
  改动: nav.library(L362)+ library.title(L857)主体库→资产库
  提交信息: chore(i18n): rename 主体库 → 资产库
  ────────────────────────────────────────
  文件: frontend/src/lib/atelierCover.ts(新)
  改动: 从 ProjectCard 抽出 export coverGradient(seed) + export GRAIN_URL(纯 TS,用 var(--color-*))
  提交信息: 与下条一起提交
  ────────────────────────────────────────
  文件: frontend/src/components/project/ProjectCard.tsx
  改动: 删本地 coverGradient/COVER_GRADIENTS/GRAIN_URL,改 import { coverGradient, GRAIN_URL } from "@/lib/atelierCover"(de-dup)
  提交信息: refactor(ui): extract shared atelierCover util (coverGradient + GRAIN_URL)
  ────────────────────────────────────────
  文件: frontend/src/components/library/AssetLibraryPage.tsx
  改动: 无图资产(原丑 ImageIcon 占位)换 atelier 文字/渐变封面(coverGradient(id) + GRAIN_URL 颗粒 + 名字首字 Fraunces);给 <AssetInspector> 传
    sourceId={selected.sourceId} sourceKind={selectedSource.kind}
  提交信息: feat(library): atelier cover fallback for image-less assets + pass source to inspector
  ────────────────────────────────────────
  文件: frontend/src/components/library/AssetInspector.tsx
  改动: 收 sourceId/sourceKind props;hero 磨砂铺底 + object-contain 不裁(治三视图裁头)+ 无图用 atelierCover;删「用于分镜」;实现「生成更多变体」(project
    来源:api.generateAsset(sourceId, assetId, SINGULAR_TYPE[type], "", undefined, "all", "", true, "", 3) → 轮询 getProject → 合并新变体 + toast;series
    来源置灰提示"请在对应剧集内生成");metadata 已数据驱动保留;下载保留
  提交信息: feat(library): frosted hero (no crop) + implement generate-more-variants + remove use-in-storyboard

  ▎ workflow 脚本已存盘:.../workflows/scripts/lib-fidelity-lineb-wf_bd0e0d03-263.js(4 个 agent 的完整 brief 都在里面,可参考)。各 agent 自报
  ▎ typecheck/colorguard 通过(除上面那个跨文件 sourceId 的并发 stale 报错)。

  🗂️  整体项目状态

  - worktree:/path/to/omni-studio-worktree,分支
  feat/atelier-pilot-20260611-161001。output/ 软链主仓;主仓 .venv 是 py3.9。
  - dev:前端 cd frontend && PORT=3010 npm run dev;后端 <主仓>/.venv/bin/python -m uvicorn src.apps.comic_gen.api:app --host 127.0.0.1 --port
  17177。沙箱挡 localhost 回环 → curl/browse/git-push 需 dangerouslyDisableSandbox:true。
  - 本地未推提交累积(满意后一次性推 github Dylan-Nihilo/OmniStudio,推前敏感扫描):
    - 设置页 phase-2:8 条(含 eccd965 提示词统一中文、715f8b6 居中画廊 等)
    - 工作区/资产库第一轮:5 条(deab95d 72b1ec7 0221221 5f09f78 e410b1c)
    - 资产库保真度第二轮:待提交(本文档上面那 5~6 条)
  - 提交规范:作者 Mike4Ellis(已配),任何提交都不写 Co-Authored-By;原子提交;只推 github。

  🔒 已锁定的设计决策(本阶段拷问结论)

  - Q1 不动全局壳,只补内容层(不加 mockup 的情境侧栏;保留横向 pill 筛选 + 系列分组)。
  - Q2 视觉 + 轻功能(不动后端);要后端的留骨架。但**「生成更多变体」用户升级为要真正实现**(已在本轮做,project 来源)。
  - Q3 角色卡 4:3 + object-contain + 同图模糊铺底(兼容横/竖图不裁);场景/道具卡保持 1:1 cover。

  🚧 仍延后(需后端,后续阶段)

  - 资产库视频实体(mockup 有"视频"类型);抽屉 SEED/MODEL/SIZE 元数据(UI 已数据驱动,后端生成时落 seed/model/size 字段即自动显示);series
  来源资产的生成变体(需后端加 series 资产生成端点);最近排序(场景/道具缺时间戳)。

  🎨 约定

  - 颜色守卫 npm run check:colors:禁硬编码 [#hex] + white-alpha;允许语义 token、black/N、内联 style 里 var(--color-*)、纯 text-white 叠有色底。
  - atelier 类(globals.css,仅 html.atelier-dark/.atelier-light
  生效):atelier-display(Fraunces)、glass-panel/atelier-card、atelier-group-line、atelier-reveal 等。
  - mockup 标尺:docs/design/tasty-sam/line-b-atelier/{workspace,library,settings}.html + tokens.css。

  🩹 工具通道故障说明

  本会话(及重启后)主循环的 Bash/Write/Edit/Agent 调用间歇性"malformed, could not be parsed"——非格式问题,是会话级故障。新会话通常恢复;若新会话也犯,可改用
  subagent(Agent 工具,model 设 opus,因本环境代理只认 opus、haiku/sonnet 会 PROXY_005 失败)在其独立上下文里跑 gate+commit。