# 积分计费（钱包 / 价格簿 / root 后台）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `feature/credits-billing` 上给托管版加上积分计费：root 在后台按"进货价 → 积分"公式维护积分表并发布版本；每个 Workspace 一个钱包；付费生成先冻结、成功按实际用量结算、失败退还；文本 LLM 按 token 结算；前端显示余额与"本次消耗"。

**Architecture:** 定价公式 `积分 = ⌈进货价 × (1+利润率) ÷ 一级折扣 ÷ 积分标价⌉`（默认 44 积分/元）由 `src/billing/pricing.py` 纯函数实现；草稿表（`pricing_settings`、`pricing_items`）经 `publish()` 冻结为不可变的 `price_book_versions`，运行时按生效版本报价，已冻结任务按各自冻结时版本结算。钱包与只追加流水（`wallets`、`credit_ledger`）所有写入带幂等键。付费路径统一挂在 `JobRepository.create_item / transition_item`（pipeline 与 playground 共用），LLM / TTS 走 `llm_adapter` / `tts.synthesize` 的计量上下文。角色 `platform_roles`（root / admin / reseller_admin）与 Workspace 角色正交，初始化平台的用户自动成为 root。

**Tech Stack:** FastAPI、SQLAlchemy 2.x（SQLite + MySQL 双方言）、Pydantic v2、Next.js 14 / React 18、pytest、Vitest。

**Spec:** 《OmniStudio积分计费体系设计.md》《积分比例后台与权限设计.md》（团队内部文档，2026-09-09）。

## Global Constraints

- 同一张积分消耗表对所有用户一致；渠道差异只体现在买积分的价格上。
- 发布时任一计费项对一级经销商利润率低于目标即拒绝发布；公式本身不做成可配置项。
- 冻结 / 结算 / 退还都在 `job_items` 状态转换的同一事务里，`credit_ledger.idempotency_key` 唯一，重复回调不重复入账。
- 没有定价的模型规格不能静默免费：报价失败 → 422 `PRICING_ITEM_NOT_FOUND`；尚未发布价格簿 → 503 `PRICE_BOOK_MISSING`。
- SQLite（桌面版）下所有测试原样通过；MySQL 下钱包行用 `SELECT ... FOR UPDATE`。
- 进货价只在 `/admin/*` 暴露，`/billing/pricing-table` 只给积分。
- 提交遵循 Conventional Commits，不加 Co-Authored-By。

---

## Task 1: 存储与核心服务 ✅（`c0b8e07`）

- [x] `schema.py` 新增 `platform_roles`、`pricing_settings`、`pricing_items`、`price_book_versions`、`wallets`、`credit_ledger`（`init_schema` 增量建表，无需迁移版本）。
- [x] `src/billing/pricing.py`（`CreditRule` / `PriceItem` / `PriceBookSnapshot` / `Quote`）。
- [x] `src/billing/price_book.py`：`PriceBookAdmin`（规则、条目、预览、发布、版本、回滚）、`PriceBookRuntime`（生效版本缓存、按版本取回、`quote` / `quote_text`）。
- [x] `src/billing/wallet.py`：`WalletService`（`credit` / `transfer` / `hold` / `settle` / `release`，幂等）。
- [x] `src/billing/roles.py`：`RoleService`（`bootstrap_root` 只在无 root 时生效，最后一个 root 不可撤销）。
- [x] 测试 `tests/test_billing_core.py`。

## Task 2: HTTP 与权限 ✅（`c0b8e07`、`b7ba5a2`）

- [x] `src/billing/routes.py`：`/billing/{wallet,ledger,quote,pricing-table}`；`/admin/pricing/*`、`/admin/roles`、`/admin/wallets/*`；`BillingError` 信封与 `AuthError` 一致；写操作进 `audit_events`。
- [x] `api.py` 挂载路由、异常处理、`app.state.billing`。
- [x] `/auth/setup` 成功后 `bootstrap_root`；`scripts/grant_platform_role.py` 给存量部署指定 root。
- [x] `config/pricing/price_book.seed.json` + `scripts/seed_price_book.py`（73 个规格，2026-09 官方市场价）。
- [x] 测试 `tests/test_billing_api.py`（真实 setup → root；成员 403；发布校验 422）。

## Task 3: 生成任务接钱包 ✅（`48fbf2c`）

**Files:**
- Create: `src/billing/metering.py`（kind/payload → `Quote` 的解析器；实际用量提取）
- Modify: `src/storage/job_repository.py`（`create_item` 冻结、`transition_item` 结算/退还，可注入 `billing`）
- Modify: `src/apps/comic_gen/job_adapters.py`、`src/apps/comic_gen/api.py`（`_create_production_item` 解析不到 workspace 改为抛错）
- Modify: `src/apps/playground/api.py`（沿用 `create_item` 钩子；报价参数来自 generation 请求）
- Modify: `src/apps/comic_gen/llm_adapter.py`、`src/audio/tts.py`（token / 字符计量）
- Test: `tests/test_billing_metering.py`

- [x] 计费项解析：按 kind 从 payload / legacy task / 项目设置取 `model_id`（legacy id → canonical mode id）、规格参数、数量；无价格 → 抛 `BillingError`。
- [x] `create_item`：报价 → `wallets.hold`（余额不足 402，不建 item）→ 把 `price_book_version` 与 quote 写进 `payload_json.billing`。
- [x] `transition_item`：`succeeded` → 按实际用量（视频秒数 / 图片张数）结算；`failed/canceled/skipped` → 退还。
- [x] 文本：改为后付费——`_chat_once` 拿到 `response.usage` 后按实际 token 扣，`tts.synthesize` 按字符扣，扣款上限为可用余额。预冻结对 token 类调用价值不大（额度未知且任务已完成），改为"余额为空时拒绝下一次调用"。
- [x] 关闭 `_create_production_item` 返回 `None` 绕过账本的路径。
- [x] 计费开关 `OMNI_STUDIO_BILLING_ENABLED`（默认 off，桌面版 / 未发布价格簿的部署不受影响）。

## Task 4: 前端 ✅（`5d7c1a1`）

- [x] 顶栏余额（`GET /billing/wallet`）与低余额提示；402 统一弹窗。
- [x] 模型选择器显示各档积分（`GET /billing/pricing-table`）；生成按钮旁"消耗 N 积分"（`POST /billing/quote`）。
- [x] root 后台页：参数与试算、模型价格表（含批量导入）、发布与版本、角色、钱包调账。

### 落地记录

- 计费挂在 `JobRepository.create_item / create_retry / transition_item`，pipeline 与 playground 共用同一条路径；`payload["billing"]` 保存报价与价格簿版本，结算按该版本重新报价。
- 视频按 ffprobe 实际秒数结算，图片按交付的 media_refs 张数结算，均以冻结额为上限。
- `_create_production_item` 在计费开启时解析不到 Workspace 直接 409，不再回落到无账本执行。
- 前端在 `/billing/wallet` 返回非 2xx 时整体隐藏，桌面版与自托管零影响。
- 测试：后端 723 passed（新增 27 个计费用例），前端 199 passed（新增 7 个）。

## Task 5: 上线

- [ ] 生产：`scripts/grant_platform_role.py --username <首个 owner> --role root`；`scripts/seed_price_book.py --publish`；root 在后台按真实进货价覆盖后再开 `OMNI_STUDIO_BILLING_ENABLED=1`。
- [ ] 存量 Workspace 钱包初始赠送额度（root 手工 grant）。
