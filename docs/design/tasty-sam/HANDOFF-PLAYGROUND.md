  # HANDOFF — Omni Studio · Playground × Line B 视觉保真

  ## 0. 环境 / 路径
  - worktree(干活处):/path/to/omni-studio-worktree,分支
  feat/atelier-pilot-20260611-161001
  - main 仓库:/path/to/OmniStudio
  - backend python:<main>/.venv/bin/python (py3.9)
  - 前端 dev server:跑在 :3010(从 worktree/frontend 起 `next dev -p 3010`)。改动不显示→先重启 + 删 frontend/.next(本会话 dev server 曾陈旧近 30h
  喂旧编译,是"刷新没变化"的元凶)。
  - 后端::17177 (FastAPI),从 worktree 起、用 main 的 .venv。
  - 主题:app 默认 atelier-dark(frontend/src/app/layout.tsx
  写死+回落)。--seed-primary=#34d8c4(teal)、--color-accent=#ffa94d(amber)、--font-display=Fraunces、--color-on-accent=#0c0b0e(深墨)。
  - 根字号:globals.css `html{font-size:112.5%}`(=18px,全局放大,用户主动要的"大一些")。⚠️ 不要为对齐 mockup 退回
  100%——本会话试过、用户明确否决,他要保留大尺寸、与工作区/资产库一致。mockup 是 16px 根,app rem ×1.125 是有意的。
  - mockup(目标):docs/design/tasty-sam/line-b-atelier/playground.html + tokens.css
  - 对比网页:docs/design/tasty-sam/playground-compare/compare.html

  ## 1. 提交/校验习惯
  - 作者 Mike4Ellis;commit 不写任何 Co-Author 行;原子提交。
  - 评审模式:约 30+ commit 未推(github),推前 secret 扫描 + 列全清单。
  - 自检:cd frontend && npm run typecheck(0 错)+ npm run check:colors(要"无违规")+ zh/en JSON 键集对齐。
  - 截图:headless Chrome（--headless=new --user-data-dir=/tmp/x --screenshot=/tmp/x.png --window-size=1600,1000 --virtual-time-budget=12000
  http://localhost:3010/#/playground）；Chrome 拍完常不退,用 `& CPID=$!;sleep 16;kill $CPID;pkill -f x` 兜底。
  - 铁律:对照 mockup 逐条 token 化改,不要自由发挥;teal/amber 实底字一律 text-on-accent(深墨),无浅字、无紫色。

  ## 2. 已完成(Playground Line B)
  - 生成按钮:亮 teal 全 pill + ✨ + 常驻 shadow-[var(--glow-primary)];永远亮(禁用只是不可点,不变暗)。⚠️ 用户要永远亮,别给禁用态加变暗。
  - 背景:Playground 根去 bg-background、compose aside 去 bg-surface-inset、sticky 生成栏 bg-transparent backdrop-blur-md → 页级 bloom(page.tsx 的
  .atelier-page-bloom)透出,卡片浮渐变上,无黑块。
  - 字号:结果标题 34px;compose 标题与工作区同款 text-[1.625rem] md:text-[2.125rem];根 112.5% 已复原(别再动)。
  - 页头:eyebrow 末段 teal 强调(key playground.header.eyebrowAccent="结果画廊")+ 副标题"自由生成 · 不绑定项目"(playground.header.subtitle)。
  - 字段控件:mono 大写标签 + bg-surface-inset 内凹井 + rounded-[14px] + lucide ChevronDown;段控激活态扁平 teal(无 glow);次级按钮 rounded-full;提示词
  textarea 去框(裸输入)。
  - 圆角:卡片 rounded-[20px];参考图 tile w-[72px] h-[72px] rounded-[14px]。
  - 此前:模板/历史弹窗已重皮+i18n;DetailPanel/GalleryView/AssetPicker 已套 Line B+i18n;全目录 CJK/紫/teal-底-浅字=0。
  - 审计全量:126 条差异(3 high/42 med/72 low/9 intentional),在
  /private/tmp/claude-502/-Users-hoshinoren-Documents-code/eadc1a31-9d26-4d73-a571-a489b06e5e76/tasks/wqnqzrimy.output(result.found +
  result.additional)。

  ## 3. 当前未决（用户本轮提的 3 件，优先做）

  ### 3.1 右侧 Playground 历史"丢失"（BUG，已诊断，待修）
  - 现象:Playground 右侧"暂无生成结果",历史不见了。
  - 根因(已查实):历史/模板是根级文件 output/playground_history.json + output/playground_templates.json(见 src/apps/playground/storage.py:15-16)。worktree
  的 output/ 只 symlink 了 output/playground/(媒体目录),这两个根级 JSON 没 symlink → worktree 后端读到空。main 仓库有真实数据(history 10975
  bytes、templates 866 bytes)。
  - 修法:先 `ls -la <wt>/output/playground_history.json` 确认其不存在/为空 + 确认后端 cwd 指向 worktree;再 symlink 到 main：
    ln -sf <main>/output/playground_history.json <wt>/output/playground_history.json
    ln -sf <main>/output/playground_templates.json <wt>/output/playground_templates.json
    重启/刷新后端后历史+模板恢复。(本地数据接线,不进 git。)

  ### 3.2 「推荐」字段逻辑（待解释）
  - 来源:playgroundModels.ts:215 → recommended: model.ui.recommended ?? false。即模型 catalog 的 ui.recommended 字段(源 config/model_catalog/*.yaml →
  生成到 frontend/src/generated/modelCatalog.json)。是 catalog 里人工标的 curated flag,不是算法。
  - 用途:ModelSelector 排序 recommended-first(:251)+ getDefaultModel 默认选推荐那个(:271)。
  - 待办:列出 ui.recommended=true 的模型,向用户解释"推荐=catalog 作者标的,改它要改 YAML 再 python
  scripts/build_model_catalog.py";若用户觉得不合理,按其意见改 catalog。

  ### 3.3 提示词「历史」+「模板」两弹窗 UI 重设计（用户邀请 grill，先拷问再做）
  - 文件:PromptHistoryDrawer.tsx(右侧抽屉,已去黑罩)、PromptTemplateModal.tsx(居中弹窗,分类 pill 已改强调色底+深墨字、video 分类色已从紫改 amber)。
  - 用户原话:"历史和模板那两个弹窗的 UI 要单独优化一下,你可以拷问我一下。"
  - 做法:新会话先 /grill-me 逐条拷问设计方向(历史抽屉 vs 内嵌面板?信息密度?每条展示什么?模板分类与预览/卡片/空态?两弹窗与 Line B 关系——mockup
  无此二稿,需原创但贴 Line B),定方向后再做+截图核对。

  ## 4. 审计余项（选择性做）
  - 结果区签名(空态看不到,需先有生成数据):本批精选 featured hero + amber halation + "BATCH · N RESULTS" 组标题 + 结果卡(SEED 标签/"保存"文字链/方形
  media/hover 全区 dim)。mockup 最招牌一块,属功能件。
  - 42 条 med 余项(compose 卡片重排让 Prompt 居首、媒体 ref-slot 布局、模型卡并入参数卡等)+ 72 条 low 微调。
  - 不要做:全局 token 批量改、把字号缩小到 mockup px、卡片大改结构(除非用户拍板)。

  ## 5. 踩过的坑
  1. dev server 陈旧→改动看不到八成是喂旧编译,kill 旧进程 + 删 .next + 重启,别反复改代码。
  2. 空态是误导视角:很多改动在折叠线以下/弹窗里,截图前后字节相同 ≠ 没改;必要时拍更高视口/交互态。
  3. "mockup 更大"真相:大在 display 字阶+间距(标题 34/24/18px+留白),不是根字号;app 的 chrome 字因 112.5% 反而偏大。方向是放大标题+开间距,不是缩小全局。
  4. 别自由发挥:用户多次因偏离 mockup/设置页样板而不满;改前先抠 mockup 的 token 逐条对齐。