# Omni Studio Remaining Requirements Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining high-confidence requirement gaps and provide a repeatable integration-test gate for the 175-item Feishu requirements set.

**Architecture:** Extend existing domain boundaries instead of adding parallel state systems. Source and revision behavior stays in `source_api.py`/`source_repository.py`; storyboard continuity stays in `storyboard_readiness.py` and persisted script/frame data; assembly editing stays in the pipeline/export boundary; UI actions persist through existing API clients and Zustand stores. Each task adds focused backend/frontend tests before implementation.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, Next.js 14, React 18, TypeScript, Zustand, Vitest, pytest, Playwright/acceptance runner, FFmpeg/ffprobe when available.

**Spec:** `docs/agents/deliverables/20260902分工/requirements-gap-analysis.md` and `docs/agents/deliverables/20260908-最新代码任务分工对照与开发计划.md`

## Global Constraints

- Do not claim a requirement is complete from file presence alone; require code, automated coverage, and an executable integration path.
- Preserve workspace isolation and existing API compatibility.
- Do not implement deferred `AUDIO-10`, `ASM-15`, or `MODEL-06` as if they were in scope.
- Use TDD for every behavior change and commit each independent task atomically.

### Task 1: Source chapter-level episode relations

**Files:**
- Modify: `src/storage/schema.py`, `src/storage/source_repository.py`, `src/apps/comic_gen/source_api.py`, `src/apps/comic_gen/source_models.py`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/components/source/SourceChapterPanel.tsx`, `frontend/src/components/source/SourceWorkspace.tsx`
- Test: `tests/test_source_domain.py`, `frontend/src/components/source/SourceChapterPanel.test.tsx`

**Interfaces:** Add workspace-scoped chapter/Episode link CRUD with idempotent `POST` and `DELETE`, returning linked Episode IDs on chapter reads.

- [ ] Write failing repository/API tests for linking one chapter to two Episodes, duplicate link idempotency, unlink, and cross-workspace rejection.
- [ ] Run the focused tests and confirm failure is due to the missing chapter relation.
- [ ] Add the relation table, repository methods, API routes, DTOs, and chapter-panel controls.
- [ ] Run focused backend/frontend tests and verify persisted links after reload.
- [ ] Commit `feat: add source chapter episode relations`.

### Task 2: Continuity ledger and preflight localization

**Files:**
- Modify: `src/apps/comic_gen/storyboard_readiness.py`, `src/apps/comic_gen/models.py`, `src/apps/comic_gen/api.py`
- Modify: `frontend/src/components/modules/storyboard-r2v/`, `frontend/src/lib/api.ts`
- Test: `tests/test_storyboard_readiness.py`, frontend storyboard tests

**Interfaces:** Return deterministic continuity issues with `shot_id`, `field`, `message`, and `blocking`; persist a ledger snapshot on the script and expose a preflight route used before generation.

- [ ] Write failing tests for adjacent scene/location mismatch, screen-direction mismatch, issue localization, and readiness blocking.
- [ ] Run focused tests to verify the missing issue list/ledger behavior.
- [ ] Implement deterministic ledger calculation and API/UI issue display.
- [ ] Run focused tests and verify a corrected shot changes `storyboard_ready` to true.
- [ ] Commit `feat: add localized storyboard continuity ledger`.

### Task 3: Assembly trim and episode segment editing

**Files:**
- Modify: `src/apps/comic_gen/models.py`, `src/apps/comic_gen/pipeline.py`, `src/apps/comic_gen/api.py`, `src/apps/comic_gen/export.py`
- Modify: `frontend/src/components/modules/VideoAssembly.tsx`, `frontend/src/lib/api.ts`
- Test: `tests/test_export_settings.py`, new `tests/test_assembly_editing.py`, frontend `VideoAssembly.test.tsx`

**Interfaces:** Add non-destructive per-shot `in_point`/`out_point`, episode segment delete/split operations, validation against media duration, and export consumption of the edit list.

- [ ] Write failing tests for valid trim, invalid range, split ordering, deletion, and persistence across reload.
- [ ] Run the focused tests and confirm the edit operations are absent.
- [ ] Implement model fields, repository/pipeline mutation, API routes, and assembly controls.
- [ ] Run focused tests plus an FFmpeg fixture export when available.
- [ ] Commit `feat: add non-destructive assembly editing`.

### Task 4: Cast reference-sheet candidate types

**Files:**
- Modify: `src/apps/comic_gen/models.py`, `src/apps/comic_gen/assets.py`, `src/apps/comic_gen/api.py`
- Modify: `frontend/src/components/modules/Cast.tsx`, `frontend/src/lib/api.ts`
- Test: `tests/test_cast_generation_flow.py`, frontend Cast integration tests

**Interfaces:** Support typed reference candidates `full_body`, `three_views`, `head_shot`, and `design_sheet` with preview/current/lock semantics while retaining legacy aliases.

- [ ] Write failing tests for candidate-type validation, selection isolation, and legacy normalization.
- [ ] Run focused tests to confirm unsupported candidate types currently fail or collapse.
- [ ] Implement typed candidate storage and UI filters/selection.
- [ ] Run focused tests and verify type-specific current selection survives reload.
- [ ] Commit `feat: support typed cast reference candidates`.

### Task 5: Visual handbook import/export and template library

**Files:**
- Create: `src/apps/comic_gen/visual_handbook.py`
- Modify: `src/apps/comic_gen/api.py`, `src/storage/schema.py`, `src/storage/repository.py`
- Create: `frontend/src/components/modules/VisualHandbook/VisualHandbookPanel.tsx`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/app/page.tsx`
- Test: `tests/test_visual_handbook.py`, frontend VisualHandbook tests

**Interfaces:** Markdown handbook parse/export, workspace-scoped CRUD, reusable templates, and preview-before-apply semantics.

- [ ] Write failing parser, export round-trip, template CRUD, and preview/confirm tests.
- [ ] Run focused tests and confirm no handbook domain exists.
- [ ] Implement deterministic Markdown schema and persistence/API/UI.
- [ ] Run focused tests and verify a handbook can be imported, edited, exported, and applied to a project preview.
- [ ] Commit `feat: add visual handbook library`.

### Task 6: Integration gate and regression cleanup

**Files:**
- Modify: `scripts/run_acceptance.py`, `frontend/e2e/acceptance-main-chain.spec.ts`, `tests/fixtures/acceptance_fixture.json`
- Modify: `tests/test_e2e_regressions.py` or test fixture isolation setup
- Create: `docs/agents/deliverables/20260910-requirements-integration-evidence.md`

**Interfaces:** One command runs backend tests, frontend typecheck/tests/build, writable acceptance flows, and records failures/evidence without silently downgrading them.

- [ ] Write a failing acceptance assertion for each new writable flow and for the missing-LLM configuration isolation.
- [ ] Run the gate to confirm each expected failure is recorded.
- [ ] Implement writable fixture setup/teardown and deterministic environment isolation.
- [ ] Run the full gate and record exact counts, artifacts, unresolved deferred items, and any external binary limitations.
- [ ] Commit `test: add requirements integration gate and evidence`.

## Completion Definition

The 175-item set is only called fully complete when every non-deferred item has implementation, focused automated coverage, and a successful writable integration path. Deferred items remain explicitly deferred. A green unit suite alone is insufficient.
