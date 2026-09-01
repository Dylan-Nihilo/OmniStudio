# Omni Studio 前端重塑 — 第二阶段 Kickoff(状态 + 锁定规格 + 代码事实)

> 单一事实来源。会话上下文压缩后,从这份恢复即可无缝继续。
> 分支:`feat/atelier-pilot-20260611-161001`(已推 github `Dylan-Nihilo/OmniStudio`)。日期 2026-06-17。

---

## A. 重塑进展(到第二阶段前)

主线 = Tasty Sam **Line B「Luminous Atelier」** 重塑(侧栏 IA + 工作区 + 资产库 + 设置 + 全局壳),前几棒完成。本会话在其上做了:

**reference_sheet 修复线 + 评审 + 响应式 + P2(全部已提交 + 已推 github):**
- `54ebe64` fix(library) §5 reference_sheet 读取 + `ee8c6cd` feat(lib) `characterImage` helper + `2b8343c` AssetCard/Import + `451b949` storyboard 簇 + `31e0adf` 库并入 helper + `2da57eb` 清死代码 + `ba6a991` onCreate 类型
- `1b3448a` 甲(P1:a11y 键盘双触发/Dialog a11y/空筛选态/系列名搜索/搜索框主题泄漏/completed→teal 光晕/下载 fetch→blob)
- `1d18ee9` 乙(toast 接错误 / 资产库品牌空态卡 / OfflineBanner)
- `edfd23d` #7 响应式(窄屏底部 tab bar / 3 header 响应式 / inspector 窄屏全屏覆盖;390/768/1280 验过)
- `b41a6e2` `b165b46` `c2bb65c` `ef90de6` `4142acc` `0684d54` `2061a8b` = P2 多轮(aria-current+Framer reduced-motion+halation-仅starred、星标精确回滚+选中筛掉关 inspector+aria-label、MuleRun 轮询泄漏、Storage 校验解耦+工作区搜索 aria-label、roving 方向键+主题 role=radio、useOnline+离线禁用、B/D 尾)

**关键架构事实(勿忘):**
- 角色图 = `reference_sheet`(canonical,`image_variants`/`selected_image_id`)+ `full_body_asset`(legacy,`variants`/`selected_id`);统一走 `frontend/src/lib/characterImage.ts` 双读,**勿直读 full_body**。`CharacterWorkbench` 是 legacy/i2v 工作台(workflow_mode!=="r2v"),勿删。
- 颜色守卫 `npm run check:colors`(扫 components,禁硬编码色/white-alpha);typecheck `npm run typecheck`。每提交都过这俩 + 原子提交 + 无 AI 署名。
- 提交作者 Mike4Ellis;只推 `github`(=公开 Dylan-Nihilo/OmniStudio),push 前敏感扫描。
- **沙箱屏蔽 localhost 回环** → curl/browse/git-push 必须 `dangerouslyDisableSandbox:true`。
- runtime QA:前端 `cd frontend && PORT=3010 npm run dev`(bg);后端 `cd <worktree> && <主仓>/.venv/bin/python -m uvicorn src.apps.comic_gen.api:app --host 127.0.0.1 --port 17177`(主仓 venv 是 py3.9,IMPORT OK)。worktree 无 .venv;output/ 软链主仓(projects.json 当前 0 项目)。**当前 dev server(3010)+ 后端(17177)正在运行。**

---

## B. 第二阶段锁定规格 · 设置页(已 grill 定稿)

**① 去黑框(FE)**:各 section 黑色面板背景去掉 → 近无框、融入页面底(atelier 语言)。模型卡/输入框保留自身表面,只去 section 外层黑框。

**② 模型 Tab(FE)**:(a)「运动模型 (I2V)」→「**首帧生视频(I2V)**」;(b)`GroupedModelGrid` **保留富卡片、重贴 atelier**:`green/blue/purple` accent(`ACCENT_CLASSES`)→ **teal(primary)**,选中=teal 边框+轻 glow,卡面 atelier 化。

**③ 默认 Prompt(FE + BE)**:
- 预填**真实内置默认**;**保存语义=delta**(框里===默认→存空=用内置,不 pin 快照;改了才存 override)。全局默认经 `injectDefaultsIntoProject`(projectStore.ts:358)喂新项目,故生效。
- **新增「分镜提取」**(剧本→分镜 Prompt B):净新增——`PromptConfig` 目前无此 key,要 BE 加 key + `analyze_to_storyboard`(llm.py:839)用上 override + 暴默认 + FE 加字段。
- 这页 UI 也去黑框 + atelier 化。

**④ API 密钥(FE)**:保存按钮底色(teal)与字色都太亮 → 调对比(按钮文字改深色 on-accent 或降按钮亮度)。

**⑤ 存储(FE + BE)**:
- (a) 目录已确认按运行用户 home(`utils/__init__.py` `get_user_data_dir`=`expanduser("~")/.omni-studio` 或 env),**无需改** ✓
- (b) AKSK 处加**阿里云 AccessKey 官方文档链接**。
- (c) **「启用云存储」开关** + 文案"启用云存储,将资产与成片上传到对象存储。关闭则仅保存在本地 output/":净新增 BE——现无 enable 标志(只看有无 OSS 凭证),要 BE 加 `OSS_ENABLE` 字段 + gate `oss_utils` 上传,FE 加开关。

**⑥ 关于(FE)**:(a)去掉「LINE B · LUMINOUS ATELIER」;(b)**检查更新**:手动按钮 → fetch `api.github.com/repos/Dylan-Nihilo/OmniStudio/releases/latest` → 比对 `v0.2.0` → 有新版显示版本 + 按钮打开 releases 页(不自更新;纯前端;GitHub 未授权限流 ~60/hr)。

---

## C. 实现所需代码事实

- 默认 polish 提示词:`pipeline.py:4416-4418` `DEFAULT_STORYBOARD_POLISH_PROMPT`/`DEFAULT_VIDEO_POLISH_PROMPT`/`DEFAULT_R2V_POLISH_PROMPT`(命名常量)。`api.py:555 GET /series/{id}/prompt_config` 已返回 `defaults`(仅这 3 个 polish)。entity_extraction/style_analysis 内置默认在 llm.py(可能内联,需暴)。
- `PromptConfig`(models.py:508)5 key:storyboard_polish/video_polish/r2v_polish/entity_extraction/style_analysis(默认 ""=用内置)。**无 storyboard_extraction**。`get_effective_prompt`(pipeline.py:1502/4411)merge episode→series→DEFAULT。
- 端点:`GET|PUT /projects/{id}/prompt_config`、`GET|PUT /series/{id}/prompt_config`;FE `api.ts:644/649/1378/1382`。
- 全局默认:Settings 存 `localStorage` `omni_studio_default_prompt_config`(SettingsPage.tsx:102/162/306);`injectDefaultsIntoProject`(projectStore.ts:358-369)读它种新项目 prompt_config。
- 目录:`utils/__init__.py:15 get_user_data_dir` / `:28 get_log_dir`;`api.py` /health 用之。
- OSS:`oss_utils.py:129/229/233 upload_file/image/video`;无 enable flag。EnvConfig 的 OSS 字段需确认(grep models.py 未直接命中,可能 env-only)。
- 模型 UI:`GroupedModelGrid.tsx` `ACCENT_CLASSES`(green/blue/purple),`bg-glass` 卡,选中 accent 边框/bg。
- 版本:前端常量 `v0.2.0`(GlobalSidebar/SettingsPage `APP_VERSION`);无后端版本端点;无现成更新检查。main.py = pywebview 打包 + 也 dev 跑。

## D. 实现批次(workflow 并行;按文件分工避免冲突)
SettingsPage.tsx 是绝大多数 FE 改动的中心文件 → 一个 owner 串行;GroupedModelGrid / 后端 / api.ts 各独立 owner 可并行。共享契约:api 函数名 + 端点路径 + 新字段名(`OSS_ENABLE`、PromptConfig `storyboard_extraction`)。每改完 typecheck+颜色守卫+原子提交。
1. 纯视觉:①去黑框 + ②模型重贴 + ④按钮对比 + ⑥a 去 LINE B
2. 前端功能:⑥b 检查更新、⑤b AKSK 链接
3. ③ 默认 Prompt 预填(FE + BE 端点暴全部默认)
4. ⑤c 云存储开关(FE + BE 字段+gate)
5. ③ 分镜提取新 key(FE + BE 接线)

## E. 评审后状态(2026-06-17 · 用户 hold 不推)

全部 phase-2 已提交、**未推**(用户选「先按住不推」,自己看 live UI,可能继续提设置页调整)。分支 `feat/atelier-pilot-20260611-161001`;dev 3010 + 后端 17177 **正在运行**(HMR / 后端重启均已生效)。

- **用户评审三连修复(本轮)**:
  - `47c0781` #1 顶部 header 去 `bg-surface` → 标题/tab 融入页面氛围层(保留 border-b 细线);SettingsPage.tsx:1086。
  - `e2b5904` #2 `ModeSegment` 选中 chip `text-white`→`text-on-accent`(SettingsControls.tsx:207)+ #3 `DEFAULT_ENTITY_EXTRACTION_PROMPT` dedent(llm.py;curl `/prompt_defaults` 确认开头变 `'\nYou are...'`,后端已重启生效)。
- **之前 phase-2**:`0b0bcf7` ⑤c 云存储开关(OSS_ENABLE)/ `0ecbb9c` / `7b63e16`。
- **待办**:等用户下一轮设置页反馈;满意后一次性推 github `Dylan-Nihilo/OmniStudio`(**推前敏感扫描**)。
- 门禁:每提交过 `npm run typecheck` + `npm run check:colors` + BE `from src.apps.comic_gen import api` import;Pyright 的 `Arguments missing for parameters...`/None-not-str 是既有静态噪音,非阻断。
