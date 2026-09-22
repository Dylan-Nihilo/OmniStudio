# 来源资料到完整生产流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将来源资料导入、章节分析、拆集和 Episode 创建后的内容，接入与工作区项目相同的剧本、资产、分镜、视频、配音、合成和导出生产链路，并保持竖屏 9:16 配置贯穿全流程。

**Architecture:** 来源资料继续由 `SourceRepository` 保存来源、章节、分析和关联关系；Episode 仍复用现有 `Script`/`Series`/`Pipeline` 数据模型。新增一个只读生产上下文接口，把来源关联、当前修订、影响项、剧本阶段和生产计划状态组合给来源页面；来源分析事件通过显式桥接服务转换为可追溯的剧本草稿和生产计划草稿，用户确认后才覆盖下游内容。统一工作区 `ProjectClient` 继续负责所有生成和导出操作，来源页只负责入口、状态和追溯。

**Tech Stack:** FastAPI、Pydantic、SQLAlchemy、Next.js 14、React 18、TypeScript、Zustand、Vitest、Pytest。

**Spec:** `AGENTS.md` 中“来源资料 → Episode → 工作区生产”的用户需求与 9:16 约束。

## Global Constraints

- 所有新功能必须先写失败测试，再写最小实现。
- 所有开发在 `feature/*`、`fix/*` 或 `docs/*` 分支进行，提交后推送 `github` 并通过 Pull Request 合并。
- 不直接推送 `main`，不修改 git author，不添加 `Co-Authored-By`。
- 工作区生产链路继续复用现有 `ProjectClient`、`Pipeline`、`Script`、`ProductionPlan` 和任务中心。
- 默认测试画幅为 `9:16`；角色、场景、道具、分镜、视频和导出都必须能读取同一 Episode 的画幅设置。
- 来源章节、修订和分析结果必须保留 source/chapter/revision 引用，人工编辑后不得静默覆盖。

### Task 1: 来源 Episode 生产上下文与工作区入口

**Files:**
- Create: `src/apps/comic_gen/source_production.py`
- Modify: `src/apps/comic_gen/source_models.py`
- Modify: `src/apps/comic_gen/source_api.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/source/SourceEpisodePanel.tsx`
- Modify: `frontend/src/components/source/SourceWorkspace.tsx`
- Test: `src/apps/comic_gen/test_source_production.py`
- Test: `frontend/src/components/source/SourceEpisodePanel.test.tsx`

**Interfaces:**
- `build_source_production_context(repository, workspace_id, episode_id) -> dict` 返回 `episode_id`、来源依赖、开放影响项、生产阶段、资产/镜头/计划计数和 `aspect_ratio`。
- `GET /episodes/{episode_id}/production-context` 返回 `SourceProductionContextRead`。
- Episode 卡片显示当前生产阶段和“进入生产工作区”按钮，点击跳转 `#/project/{episode_id}`。

- [ ] **Step 1: Write the failing test**

```python
def test_source_production_context_includes_episode_mapping_and_portrait_ratio(client, linked_episode):
    response = client.get(f"/episodes/{linked_episode.id}/production-context")
    assert response.status_code == 200
    body = response.json()
    assert body["episode_id"] == linked_episode.id
    assert body["source_dependencies"]
    assert body["aspect_ratio"] == "9:16"
    assert "production_stage" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_source_production.py::test_source_production_context_includes_episode_mapping_and_portrait_ratio -q`

Expected: FAIL with `404 Not Found` because the endpoint and response model do not exist.

- [ ] **Step 3: Write minimal implementation**

Add `SourceProductionContextRead`, call the existing source repository dependency/impact methods, load the Episode through the pipeline, derive counts from `Script`, and return a default `9:16` when the Episode has no explicit storyboard ratio. Add a `sourceApi.getProductionContext` client method and a panel button that navigates to `#/project/{id}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_source_production.py -q` and `cd frontend; npm test -- --run src/components/source/SourceEpisodePanel.test.tsx`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/source_production.py src/apps/comic_gen/source_models.py src/apps/comic_gen/source_api.py frontend/src/lib/api.ts frontend/src/components/source/SourceEpisodePanel.tsx frontend/src/components/source/SourceWorkspace.tsx src/apps/comic_gen/test_source_production.py frontend/src/components/source/SourceEpisodePanel.test.tsx
git commit -m "feat: expose source episode production context"
```

### Task 2: 分析事件到剧本草稿桥接

**Files:**
- Create: `src/apps/comic_gen/source_script_bridge.py`
- Modify: `src/apps/comic_gen/source_api.py`
- Modify: `src/apps/comic_gen/source_models.py`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/source/SourceAnalysisPanel.tsx`
- Test: `src/apps/comic_gen/test_source_script_bridge.py`

**Interfaces:**
- `build_script_draft_from_source_events(events, chapter, existing_script) -> ScriptDraftBridge`。
- `POST /episodes/{episode_id}/source-script-draft` 支持 preview/apply，保存 source 引用元数据。

- [ ] **Step 1: Write the failing test**

```python
def test_source_events_become_traceable_script_draft(events, chapter):
    draft = build_script_draft_from_source_events(events, chapter, None)
    assert draft.nodes[0].type == "scene_heading"
    assert draft.nodes[0].source_excerpt == events[0].source_excerpt
    assert draft.source_revision_id == chapter.current_revision_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_source_script_bridge.py::test_source_events_become_traceable_script_draft -q`

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Map each event to heading/action/dialogue nodes, preserve chapter and revision identifiers, reject apply when the script has a newer manual revision unless `force=true`, and expose preview/apply responses.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_source_script_bridge.py -q`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/source_script_bridge.py src/apps/comic_gen/source_api.py src/apps/comic_gen/source_models.py frontend/src/lib/api.ts frontend/src/components/source/SourceAnalysisPanel.tsx src/apps/comic_gen/test_source_script_bridge.py
git commit -m "feat: bridge source analysis into script drafts"
```

### Task 3: 剧本草稿到可编辑生产计划

**Files:**
- Create: `src/apps/comic_gen/source_plan_bridge.py`
- Modify: `src/apps/comic_gen/source_api.py`
- Modify: `frontend/src/components/source/SourceAnalysisPanel.tsx`
- Test: `src/apps/comic_gen/test_source_plan_bridge.py`

**Interfaces:**
- `build_production_plan_draft(events, script, assets, aspect_ratio="9:16") -> ProductionPlan`。
- 每个 PlannedShot 必须有 `description`、`camera`、`duration`、`source_quote`，并把角色/场景/道具名放入 reference_names。

- [ ] **Step 1: Write the failing test**

```python
def test_plan_draft_contains_editable_portrait_shots(events, script):
    plan = build_production_plan_draft(events, script, {}, aspect_ratio="9:16")
    assert plan.segments[0].shots[0].source_quote == events[0].source_excerpt
    assert plan.metadata["aspect_ratio"] == "9:16"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_source_plan_bridge.py::test_plan_draft_contains_editable_portrait_shots -q`

Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Create deterministic segments/shots from source events, resolve known asset names, set portrait metadata, and let the existing production plan dialog review/apply the draft.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_source_plan_bridge.py -q`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/source_plan_bridge.py src/apps/comic_gen/source_api.py frontend/src/components/source/SourceAnalysisPanel.tsx src/apps/comic_gen/test_source_plan_bridge.py
git commit -m "feat: create production plans from source events"
```

### Task 4: 资产匹配、生成与连续性引用

**Files:**
- Modify: `src/apps/comic_gen/source_plan_bridge.py`
- Modify: `src/apps/comic_gen/pipeline.py`
- Modify: `frontend/src/components/source/SourceWorkspace.tsx`
- Test: `src/apps/comic_gen/test_source_asset_bridge.py`

- [ ] **Step 1: Write the failing test**

```python
def test_unknown_source_names_are_pending_assets_and_known_names_reuse_shared_assets(...):
    result = resolve_source_asset_references(...)
    assert result.pending[0].status == "pending"
    assert result.references["林默"] == "shared-character-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_source_asset_bridge.py::test_unknown_source_names_are_pending_assets_and_known_names_reuse_shared_assets -q`

Expected: FAIL because no source asset bridge exists.

- [ ] **Step 3: Write minimal implementation**

Reuse `resolve_episode_assets`, shared series assets, lock/replacement behavior, and create pending generation entries for unresolved names without silently inventing IDs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_source_asset_bridge.py -q`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/source_plan_bridge.py src/apps/comic_gen/pipeline.py frontend/src/components/source/SourceWorkspace.tsx src/apps/comic_gen/test_source_asset_bridge.py
git commit -m "feat: bind source references to reusable assets"
```

### Task 5: 9:16 设置贯穿 Episode 生产

**Files:**
- Modify: `src/apps/comic_gen/pipeline.py`
- Modify: `src/apps/comic_gen/api.py`
- Modify: `frontend/src/components/project/ProjectClient.tsx`
- Modify: `frontend/src/components/modules/StoryboardR2V.tsx`
- Test: `src/apps/comic_gen/test_portrait_production_defaults.py`

- [ ] **Step 1: Write the failing test**

```python
def test_source_episode_defaults_all_visual_stages_to_portrait(...):
    settings = production_settings_for_episode(...)
    assert settings.character_aspect_ratio == "9:16"
    assert settings.scene_aspect_ratio == "9:16"
    assert settings.prop_aspect_ratio == "9:16"
    assert settings.storyboard_aspect_ratio == "9:16"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_portrait_production_defaults.py::test_source_episode_defaults_all_visual_stages_to_portrait -q`

Expected: FAIL because existing defaults are mixed `16:9`/`1:1`.

- [ ] **Step 3: Write minimal implementation**

Apply portrait defaults only to Episodes created from source split or explicitly marked source production, persist them in Episode settings, and pass the same ratio to storyboard, video, preview and export requests.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_portrait_production_defaults.py -q` plus frontend typecheck.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/pipeline.py src/apps/comic_gen/api.py frontend/src/components/project/ProjectClient.tsx frontend/src/components/modules/StoryboardR2V.tsx src/apps/comic_gen/test_portrait_production_defaults.py
git commit -m "feat: carry portrait settings through source episodes"
```

### Task 6: 完整生成、配音、合成和导出验收

**Files:**
- Modify: `src/apps/comic_gen/api.py`
- Modify: `frontend/src/components/source/SourceEpisodePanel.tsx`
- Modify: `frontend/src/components/project/ProjectClient.tsx`
- Test: `src/apps/comic_gen/test_source_to_export_flow.py`
- Test: `frontend/src/components/source/SourceWorkspace.test.tsx`

- [ ] **Step 1: Write the failing test**

```python
def test_source_episode_can_reach_export_ready_state(...):
    context = client.get(f"/episodes/{episode_id}/production-context").json()
    assert context["stages"] == ["script", "assets", "storyboard", "video", "audio", "assembly", "export"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest src/apps/comic_gen/test_source_to_export_flow.py::test_source_episode_can_reach_export_ready_state -q`

Expected: FAIL because source context does not expose the complete stage contract.

- [ ] **Step 3: Write minimal implementation**

Expose stage states and retryable failure IDs from the existing job/task records, render a production checklist on the source Episode card, and keep every stage navigable to the same `ProjectClient` step.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest src/apps/comic_gen/test_source_to_export_flow.py -q`; `cd frontend; npm run typecheck`; `npm run test:all`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps/comic_gen/api.py frontend/src/components/source/SourceEpisodePanel.tsx frontend/src/components/project/ProjectClient.tsx src/apps/comic_gen/test_source_to_export_flow.py frontend/src/components/source/SourceWorkspace.test.tsx
git commit -m "feat: expose complete source production checklist"
```

## Verification and release

- [ ] Run backend focused tests after every task, then `pytest -q` before the PR.
- [ ] Run `cd frontend; npm run typecheck; npm run test:all; npm run build`.
- [ ] Run `python scripts/check_workflow_parity.py` if any mirrored workflow file changes.
- [ ] Push only to `github` and open a PR from `feature/source-to-production-pipeline`.
- [ ] Do not claim the full flow is complete until a source Episode reaches editable script, asset, portrait storyboard, video, audio, assembly and export states in an end-to-end test.
