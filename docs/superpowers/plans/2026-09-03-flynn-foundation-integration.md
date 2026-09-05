# Flynn 基础底座与端到端集成交付实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `feature/sflynnn-omni` 上补齐 Flynn 负责的共享底座、任务可恢复性和验收能力，把 `登录 → Source → Project/Episode → Script → Cast → Shot → Video → Audio → Assembly → Export` 接成一条可复现、可审计、可发布的主链。

**Architecture:** 以现有 SQLAlchemy SQLite 身份/Workspace 表和 JSON 业务聚合为基础，新增 Workspace-scoped 的 `Job/JobItem` 任务账本、统一状态转换、幂等键和审计事件；业务域只通过稳定 DTO 和媒体引用接入，不复制第二套任务状态。前端保留 Studio 与 Atelier 状态隔离，在 Studio 的全局导航和项目上下文中增加任务中心、恢复提示和错误定位；最终用固定 fixture 和模拟 Provider 完成端到端验收，不使用真实生产密钥。

**Tech Stack:** FastAPI、Pydantic、SQLAlchemy/SQLite、Python 3.11+、Next.js 14、React 18、TypeScript、Zustand、Axios、Vitest、pytest、Playwright、ffprobe。

**Spec:** `docs/agents/deliverables/20260902分工/task-brief-flynn-lead-and-acceptance.md`、`docs/agents/deliverables/20260902分工/requirements-gap-analysis.md`、`docs/agents/deliverables/20260902分工/LumenX_产品需求文档_v1.0.md`。

## Global Constraints

- 所有开发保留在 `feature/sflynnn-omni`，不得直接修改 `main`。
- 共享文件 `src/apps/comic_gen/api.py`、`src/apps/comic_gen/models.py`、`frontend/src/lib/api.ts`、`frontend/src/app/page.tsx` 和全局导航由负责人统一整合。
- 业务域只消费统一 `Job/JobItem` DTO；不得在 Cast/Shot/Audio/Assembly 中新增第二套任务状态。
- 付费生成必须先写入任务账本，服务端幂等键阻止重复计费；重试创建新 `JobItem` 并保留 `retry_of` 关系。
- 单个 `JobItem` 只能是 `pending/processing/succeeded/failed/canceled/skipped` 之一；`partially_succeeded` 只允许作为 Job 汇总状态。
- 任务完成的唯一条件是结果已持久化且媒体引用可读取；Provider 返回 URL 但本地未落盘不得标记完成。
- API Key 不回显、不入普通日志、不进入项目或导出包；错误返回脱敏信息，原始响应只进入受控诊断字段。
- `AUDIO-10`、`ASM-15`、`MODEL-06` 保持 Deferred；`SHOT-09/10` 先做技术 spike，不把未验证能力写成 P0 完成。
- 每个独立功能按“模型/存储 → API → UI → 测试”拆成原子提交，不添加 `Co-Authored-By`。

---

## 当前基线与缺口

- 已有：用户/会话/Workspace 表、Owner 引导、路由保护、旧数据认领、项目/系列基础 CRUD、脚本 CAS revision、局部视频任务取消/轮询、媒体路径安全和基础导出验收。
- 需要补齐：统一 Job/JobItem 与状态历史、服务重启恢复、幂等和付费调用去重、全局任务入口与项目内任务视图、统一错误/权限依赖、REL-15 审计、REL-16 通用 revision/依赖指纹/stale、退出后的前端数据清理、固定 E2E fixture、安全/性能/发布证据。
- 外部依赖：成员 A 提供 Source/Project/Episode/Script/Director Plan DTO 和 fixture；成员 B 提供 Cast/Shot/Video/Audio/Assembly 的 Job adapter、媒体引用和 ffprobe 证据。负责人只负责契约、接线和验收，不跨域重写业务实现。

## Task 1: 锁定共享 DTO、错误码与测试 fixture

**Files:**
- Create: `src/apps/comic_gen/contracts.py`
- Modify: `src/apps/comic_gen/models.py`
- Modify: `src/apps/comic_gen/api.py`
- Create: `tests/fixtures/acceptance_fixture.json`
- Create: `tests/test_shared_contracts.py`
- Create: `tests/test_acceptance_fixture.py`

**Interfaces:**
- `JobStatus`：`pending | processing | succeeded | failed | canceled | skipped`。
- `JobItemDTO`：`id`, `job_id`, `workspace_id`, `project_id`, `episode_id`, `kind`, `status`, `progress`, `idempotency_key`, `retry_of`, `error_code`, `error_message`, `media_refs`, `created_at`, `updated_at`, `started_at`, `finished_at`。
- `JobDTO`：`id`, `workspace_id`, `project_id`, `episode_id`, `kind`, `status`, `total`, `succeeded`, `failed`, `canceled`, `skipped`, `items`, `created_at`, `updated_at`。
- `APIErrorDTO`：`code`, `message`, `request_id`, `details`；凭据、Provider 原始响应和本地绝对路径不得出现在 `details`。
- 固定 fixture 至少包含 1 个 Workspace、1 个 Project、2 个 Episode、3 个章节、5 个场景、2 个角色和可替换的媒体占位引用。

- [ ] **Step 1: 编写契约失败测试**：断言枚举值、批量统计规则、错误 DTO 脱敏和 fixture 关系完整。
- [ ] **Step 2: 运行测试确认失败**：`pytest tests/test_shared_contracts.py tests/test_acceptance_fixture.py -q`；预期因契约类型和 fixture 尚未存在而失败。
- [ ] **Step 3: 实现最小契约与 fixture**：在 `contracts.py` 集中定义 DTO、状态枚举和错误码注册表；在 `models.py` 仅保留兼容别名，避免业务模块继续扩展旧状态。
- [ ] **Step 4: 接入 API 错误响应**：为新增路由统一返回 `APIErrorDTO`，并保留现有客户端可读取的 HTTP 状态码。
- [ ] **Step 5: 验证并提交**：运行两组测试和 `python -m compileall src/apps/comic_gen`；提交 `feat: define shared job and api contracts`。

## Task 2: 实现 Job/JobItem 持久化、状态机与幂等

**Files:**
- Modify: `src/storage/schema.py`
- Create: `src/storage/job_repository.py`
- Modify: `src/storage/db.py`
- Modify: `src/storage/migration.py`
- Create: `tests/test_job_repository.py`
- Create: `tests/test_job_state_machine.py`
- Create: `tests/test_job_idempotency.py`

**Interfaces:**
- `JobRepository.create_job(workspace_id, kind, project_id=None, episode_id=None, metadata=None) -> JobRecord`。
- `JobRepository.create_item(job_id, kind, idempotency_key, payload, retry_of=None) -> JobItemRecord`；相同 Workspace/幂等键返回已有项，不产生新计费项。
- `JobRepository.transition_item(item_id, target_status, *, progress=None, error=None, media_refs=None) -> JobItemRecord`；拒绝终态回退和非法跳转。
- `JobRepository.list_jobs(workspace_id, project_id=None, episode_id=None, status=None, query=None, page=1, page_size=20) -> PaginatedJobs`。
- `JobRepository.recover_inflight(workspace_id=None) -> RecoveryReport`；重启后可恢复项回到 `processing`，不可恢复项进入带原因的 `failed`。

- [ ] **Step 1: 写状态机和唯一索引测试**：覆盖合法转换、非法转换、终态幂等、重复提交、retry 关联和分页。
- [ ] **Step 2: 运行 `pytest tests/test_job_*.py -q` 验证失败**：预期缺少表、Repository 和转换实现。
- [ ] **Step 3: 添加 SQLAlchemy 表与迁移**：新增 `jobs`、`job_items`、`job_item_events`，为 `(workspace_id, idempotency_key)` 建唯一索引，为状态/更新时间/项目建立查询索引。
- [ ] **Step 4: 实现原子状态转换**：在单事务中更新任务、写事件、校验状态和媒体引用；成功状态必须有至少一个可验证媒体引用或明确的非媒体结果类型。
- [ ] **Step 5: 实现重启恢复和幂等**：启动时扫描未结束项，根据 adapter 能力恢复或失败；重复请求返回原 JobItem 和 `idempotent=true`。
- [ ] **Step 6: 验证并提交**：运行任务仓储全套测试及 `pytest tests/test_storage_schema.py tests/test_storage_migration.py -q`；提交 `feat: add persistent job ledger and idempotency`。

## Task 3: 统一权限、媒体引用、配置迁移与审计事件

**Files:**
- Create: `src/apps/comic_gen/audit.py`
- Create: `src/apps/comic_gen/revision.py`
- Modify: `src/apps/comic_gen/api.py`
- Modify: `src/storage/repository.py`
- Modify: `src/storage/schema.py`
- Modify: `frontend/src/store/authStore.ts`
- Modify: `frontend/src/lib/apiClient.ts`
- Create: `tests/test_audit_events.py`
- Create: `tests/test_revision_fingerprint.py`
- Create: `tests/test_workspace_scope_regression.py`
- Modify: `frontend/src/__tests__/auth-routing.test.ts`

**Interfaces:**
- `require_workspace_access(request, workspace_id, minimum_role="member") -> WorkspaceContext`。
- `audit.record(actor_user_id, workspace_id, action, object_type, object_id, metadata) -> AuditEvent`；metadata 自动脱敏。
- `revision.compute_revision(payload) -> str`；`revision.compute_dependency_fingerprint(kind, refs, params) -> str`。
- `revision.evaluate_stale(current_revision, stored_revision, current_fingerprint, stored_fingerprint) -> bool`。
- `media_ref_for_path(path, workspace_id) -> MediaRef`；所有受保护媒体/导出路由只接受 `MediaRef` 或服务端生成的签名地址。

- [ ] **Step 1: 编写越权、审计和 stale 失败测试**：覆盖跨 Workspace 项目/任务/媒体访问、登录/重试/删除/Provider 配置事件、输入变化只使真实依赖 stale。
- [ ] **Step 2: 运行聚焦测试确认缺口**：`pytest tests/test_audit_events.py tests/test_revision_fingerprint.py tests/test_workspace_scope_regression.py -q`。
- [ ] **Step 3: 实现统一依赖和审计写入**：将现有路由中的重复 Workspace 判断替换为统一依赖；对登录、权限拒绝、删除、模型配置、重试和取消写审计事件。
- [ ] **Step 4: 接入 revision/stale**：复用脚本现有 payload hash，扩展到 Source/Shot/Audio/Take 的引用和参数指纹；API 返回 `revision`, `dependency_fingerprint`, `stale` 和影响对象摘要。
- [ ] **Step 5: 完成退出清理与配置迁移**：退出时清理 active Workspace、项目缓存、任务缓存和敏感内存状态；配置迁移只写新格式并保留可回滚迁移记录。
- [ ] **Step 6: 验证并提交**：运行认证、媒体、迁移、存储回归测试和前端 auth tests；提交 `feat: enforce workspace scope and audit revisions`。

## Task 4: 暴露统一任务 API 与恢复/重试协议

**Files:**
- Modify: `src/apps/comic_gen/api.py`
- Modify: `src/apps/playground/api.py`
- Modify: `src/apps/playground/service.py`
- Modify: `src/apps/playground/storage.py`
- Modify: `frontend/src/lib/api.ts`
- Create: `tests/test_tasks_api.py`
- Modify: `tests/test_playground_cancel.py`

**Interfaces:**
- `GET /tasks?project_id=&episode_id=&status=&q=&page=&page_size=`：返回 `PaginatedJobs`。
- `GET /tasks/{job_id}`：返回 Job、JobItem 和状态事件历史。
- `POST /tasks/{job_id}/cancel`：只取消尚未完成项，明确区分 `canceled` 与 `failed`。
- `POST /tasks/{job_id}/retry`：为失败项创建新 JobItem，返回 `retry_of` 和新的幂等键。
- `GET /tasks/summary?project_id=&episode_id=`：返回运行中、成功、失败、取消、跳过统计。
- `api.listTasks`, `api.getTask`, `api.cancelTask`, `api.retryTask`, `api.getTaskSummary`：所有方法携带当前 Workspace header，并解析 `APIErrorDTO`。

- [ ] **Step 1: 添加 API 契约测试**：覆盖分页筛选、详情事件、取消语义、重试关联、跨 Workspace `404/403` 和批量部分失败统计。
- [ ] **Step 2: 运行 `pytest tests/test_tasks_api.py tests/test_playground_cancel.py -q` 确认失败**。
- [ ] **Step 3: 实现 FastAPI 路由**：从 JobRepository 读取，不再直接拼接各业务模块的内存任务数组；保留现有视频/Playground 端点作为 adapter 入口。
- [ ] **Step 4: 接通取消和重试**：更新本地任务状态、停止前端轮询、阻止迟到 Provider 回写覆盖 `canceled`；重试只复制安全输入引用，不复制旧错误和旧媒体结果。
- [ ] **Step 5: 更新 TypeScript 客户端与错误处理**：为 DTO 建类型，统一处理 401/403/409/429/5xx 和 request id。
- [ ] **Step 6: 验证并提交**：运行后端聚焦测试及 `cd frontend; npm run typecheck`；提交 `feat: expose unified task APIs`。

## Task 5: Studio 全局任务中心与工作区入口

**Files:**
- Create: `frontend/src/components/tasks/TaskCenter.tsx`
- Create: `frontend/src/components/tasks/TaskCenterRow.tsx`
- Create: `frontend/src/components/tasks/taskCenterModel.ts`
- Modify: `frontend/src/components/layout/GlobalSidebar.tsx`
- Modify: `frontend/src/components/layout/AppShell.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/globals.css`
- Create: `frontend/src/__tests__/TaskCenter.test.tsx`
- Modify: `frontend/src/__tests__/GlobalSidebar.test.tsx`

**Interfaces:**
- `TaskCenter` props：`workspaceId`, `projectId?`, `episodeId?`, `onOpenObject(objectRef)`, `onClose()`。
- `taskCenterModel.toViewModel(job) -> TaskViewModel`：将后端状态映射为可读阶段、错误、恢复动作和跳转目标。
- 全局导航显示项目内运行中/失败数量；任务中心支持状态筛选、搜索、分页、取消、重试、详情和跳回 Shot/Asset/Export。

- [ ] **Step 1: 编写 UI 失败测试**：渲染运行中、部分失败、取消和空态；断言状态不只依靠颜色，错误行有重试入口，点击对象可导航。
- [ ] **Step 2: 运行 `cd frontend; npx vitest run src/__tests__/TaskCenter.test.tsx src/__tests__/GlobalSidebar.test.tsx` 验证失败**。
- [ ] **Step 3: 实现任务中心数据层**：使用 `api.listTasks/getTaskSummary`，按 project/episode 上下文过滤；页面离开后不清空服务器任务。
- [ ] **Step 4: 接入全局导航与路由**：增加 `#/tasks` 或等价 Studio 路由，保留 Atelier hash 路由和状态隔离；徽章显示真实运行中/失败数。
- [ ] **Step 5: 完成交互状态**：加入加载骨架、无任务提示、部分失败清单、危险操作确认、网络中断恢复和小屏查看/恢复动作。
- [ ] **Step 6: 验证并提交**：运行 TaskCenter、现有 QueuePanel、路由和 typecheck 测试；提交 `feat: add workspace task center`。

## Task 6: 接入成员 A/B 业务链并完成最小样片

**Files:**
- Modify: `src/apps/comic_gen/api.py`
- Modify: `src/apps/comic_gen/pipeline.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/page.tsx`
- Create: `tests/test_end_to_end_acceptance.py`
- Create: `tests/test_job_adapter_contracts.py`
- Create: `frontend/src/__tests__/main-chain-navigation.test.tsx`
- Create: `tests/fixtures/provider_responses.json`

**Interfaces:**
- `ContentOutputAdapter.to_production_input(source_or_script) -> ProductionInput`：只传稳定 ID、revision、引用和已确认字段。
- `ProductionJobAdapter.submit(input, idempotency_key) -> JobItemRecord`、`poll(item_id) -> JobItemRecord`、`recover(item_id) -> RecoveryAction`。
- `AcceptanceHarness.run_fixture(fixture_name="main-chain-3-episode") -> AcceptanceReport`：记录每一步 HTTP 响应、Job/JobItem 状态、revision/stale 和媒体路径。

- [ ] **Step 1: 先写联调契约失败测试**：用 fake Source/Script 输出喂给 Cast/Shot，再将选定 Take 喂给 Audio/Assembly；断言 revision 和 Workspace ID 全程不丢失。
- [ ] **Step 2: 运行 `pytest tests/test_job_adapter_contracts.py tests/test_end_to_end_acceptance.py -q` 确认尚未接线**。
- [ ] **Step 3: 接入成员 A 输出**：增加 Source/Script 到生产输入的字段映射、版本校验和缺失字段错误，不修改成员 A 的领域实现。
- [ ] **Step 4: 接入成员 B 任务 adapter**：将 Cast/Shot/Video/Audio/Assembly 的创建、轮询、取消、重试和媒体回写接入 JobRepository；保留 provider 适配器原始错误的受控日志。
- [ ] **Step 5: 跑固定最小样片**：使用 fake Provider 生成可读取的图片/音频/视频 fixture；确保页面刷新或服务重启后仍能恢复并跳回对象。
- [ ] **Step 6: 验证并提交**：运行端到端后端测试、前端导航测试和一次本地操作记录；提交 `feat: wire content and production main chain`。

## Task 7: 安全、可靠性、性能与发布验收

**Files:**
- Create: `tests/test_security_acceptance.py`
- Create: `tests/test_restart_recovery_acceptance.py`
- Create: `frontend/e2e/main-chain.spec.ts`
- Create: `scripts/run_acceptance.py`
- Create: `docs/agents/deliverables/20260902分工/flynn-acceptance-report.md`
- Modify: `README.md`
- Modify: `USER_MANUAL.md`

**Interfaces:**
- `scripts/run_acceptance.py --fixture main-chain-3-episode --output docs/agents/deliverables/20260902分工/flynn-acceptance-report.md`：执行固定验收并输出可追溯证据。
- Playwright 流程覆盖登录、Workspace 切换、任务中心、刷新恢复、失败重试、取消和导出下载。
- ffprobe 验收记录视频流、音频流、时长、分辨率、帧率、编码和导出配置的一致性。

- [ ] **Step 1: 编写安全/恢复/E2E 失败测试**：覆盖越权媒体、API Key 泄漏扫描、CSRF/Token、重启恢复、重复点击和 20 项批量部分失败。
- [ ] **Step 2: 运行聚焦测试建立基线**：`pytest tests/test_security_acceptance.py tests/test_restart_recovery_acceptance.py -q`；`cd frontend; npm run test:all`。
- [ ] **Step 3: 实现必要修复**：只修复由验收暴露的共享底座问题；所有修复单独提交并附复现测试。
- [ ] **Step 4: 运行完整验证**：`pytest -q`、`cd frontend; npm run typecheck`、`cd frontend; npm run test`、`cd frontend; npm run build`、`cd frontend; npx playwright test frontend/e2e/main-chain.spec.ts`。
- [ ] **Step 5: 运行 catalog 和工作流检查**：`python scripts/build_model_catalog.py`、`python scripts/validate_model_catalog.py`、`python scripts/check_workflow_parity.py`（仅当工作流文件被修改）。
- [ ] **Step 6: 整理发布证据并提交**：填写验收报告、变更说明、已知限制、迁移/启动/回滚步骤；提交 `chore: freeze acceptance evidence and release notes`。发布前只推送 `github` 远端并通过 Pull Request 合并，绝不直推 `main`。

## 时间安排与检查点

- **D+0**：完成本计划、契约目录、固定 fixture、任务状态板和 E2E smoke 骨架。
- **D+2**：Task 1-3 完成；权限依赖、Job/JobItem DTO、错误码、Revision/Audit 草案评审通过。
- **D+5**：Task 2-4 完成；任务持久化、幂等键、媒体引用和第一轮迁移通过测试。
- **D+8**：Task 5 完成；Source/Script 与 Cast/Shot 第一次联调，任务中心可查看项目内任务。
- **D+12**：Task 6 完成；Video/Audio/Assembly 接线，固定 fixture 能生成一集最小样片。
- **D+16**：服务重启恢复、全局任务入口和关键失败路径通过验收。
- **D+20**：全量测试、安全、性能和发布候选版本完成。
- **D+22**：版本冻结，交付包、回滚方案和已知限制完成。

## 自检结果

- 需求覆盖：AUTH/WORK/TASK/REL 的负责人范围分别由 Task 3、Task 4、Task 2/4/5、Task 3/7 覆盖；集成与最终交付由 Task 6/7 覆盖。
- 低冲突边界：成员 A/B 只提供 DTO、adapter 和业务域测试；共享 `api.py`、`models.py`、`api.ts`、`page.tsx` 由负责人按任务顺序整合。
- 明确延期：AUDIO-10、ASM-15、MODEL-06 不在实现任务中；SHOT-09/10 只在验收报告记录 spike 结论。
- 验收证据：每个任务都有失败测试、通过命令、原子提交和可追溯 fixture/媒体证据。
