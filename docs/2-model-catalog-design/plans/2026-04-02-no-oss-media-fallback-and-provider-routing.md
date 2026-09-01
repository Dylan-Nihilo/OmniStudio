# No-OSS Media Fallback And Provider Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the full script-to-assets-to-storyboard-to-video flow work without user-configured OSS, while supporting provider routing that prefers DashScope for Wan, Kling, Vidu, and future Pixverse, but still allows users to opt into direct vendor APIs with their own credentials.

**Architecture:** Keep local files as the source of truth for generated and uploaded media. Add a unified media input resolver that converts local project files into provider-compatible request inputs at the last moment, using OSS signed URLs when available, DashScope temporary file URLs or inline image data when OSS is absent, and vendor-native formats when a model is routed to the original provider. Add a model/provider registry so model selection, auth requirements, and media transport rules are data-driven rather than hardcoded in each adapter.

**Tech Stack:** FastAPI, Pydantic, local filesystem under `output/`, existing DashScope/Kling/Vidu adapters, Next.js/React frontend, pytest, Vitest.

---

### Task 1: Document the target routing and storage rules

**Files:**
- Modify: `AGENTS.md`
- Modify: `CONTRIBUTING.md`
- Test: none

**Step 1: Add the high-level invariants**

Write the following rules into repo docs:

- Local files under `output/` are always written first and remain the durable project source.
- OSS is an optional mirror plus signed-URL service, not the only supported storage backend.
- DashScope is the preferred backend for supported models.
- Vendor-direct access for Kling/Vidu remains supported when user credentials are configured and selected.

**Step 2: Add provider-routing vocabulary**

Document these concepts so later code and UI use the same language:

- `storage_mode`: `local_only` or `local_plus_oss`
- `provider_backend`: `dashscope` or `vendor`
- `media_ref`: stable project-side media reference
- `resolved_media_input`: request-side payload ready for a specific provider

**Step 3: Commit**

```bash
git add AGENTS.md CONTRIBUTING.md
git commit -m "docs: define local-first media and provider routing rules"
```


### Task 2: Introduce provider routing config models

**Files:**
- Modify: `src/apps/comic_gen/api.py`
- Modify: `src/apps/comic_gen/models.py`
- Create: `src/utils/provider_registry.py`
- Test: `tests/test_provider_registry.py`

**Step 1: Write the failing registry tests**

Create tests that assert:

- `wan2.6-*` models route to `dashscope`
- `kling-*` models default to `dashscope` when `KLING_PROVIDER_MODE` is unset
- `vidu*` models default to `dashscope` when `VIDU_PROVIDER_MODE` is unset
- `kling-*` and `vidu*` can route to `vendor` when explicit config is set
- future `pixverse-*` entries can be registered without changing resolver code

**Step 2: Run the test to verify it fails**

Run:

```bash
pytest tests/test_provider_registry.py -q
```

Expected: FAIL because the registry module does not exist yet.

**Step 3: Add a provider registry**

Create a small data-driven registry with entries like:

- model family
- backend default
- credential source
- supported modalities
- image input mode
- audio input mode
- reference video input mode

Do not encode business logic in string `startswith` checks all over adapters after this.

**Step 4: Add environment-backed routing config**

Extend config models and `/config/env` serialization to support:

- `KLING_PROVIDER_MODE`: `dashscope` or `vendor`
- `VIDU_PROVIDER_MODE`: `dashscope` or `vendor`
- `PIXVERSE_PROVIDER_MODE`: `dashscope` or `vendor`

Default all three to `dashscope` when absent.

**Step 5: Re-run the tests**

Run:

```bash
pytest tests/test_provider_registry.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/utils/provider_registry.py src/apps/comic_gen/api.py src/apps/comic_gen/models.py tests/test_provider_registry.py
git commit -m "feat(config): add provider routing registry and modes"
```


### Task 3: Add stable media reference utilities

**Files:**
- Create: `src/utils/media_refs.py`
- Modify: `src/utils/oss_utils.py`
- Test: `tests/test_media_refs.py`

**Step 1: Write the failing tests**

Cover:

- detect local relative path like `uploads/foo.png`
- detect local absolute path under `output/`
- detect OSS object key
- detect remote URL
- detect `data:` URI without treating it as durable storage
- normalize local refs to absolute filesystem paths for backend use

**Step 2: Run the test to verify it fails**

Run:

```bash
pytest tests/test_media_refs.py -q
```

Expected: FAIL because helper module does not exist yet.

**Step 3: Implement media reference helpers**

Add helpers such as:

- `classify_media_ref(value) -> local_path | object_key | remote_url | data_uri | unknown`
- `resolve_local_media_path(value) -> absolute path`
- `is_remote_media_ref(value)`
- `is_stable_project_media_ref(value)`

Keep project data storage stable. Never write `base64` blobs back into `Script` or `VideoTask` records.

**Step 4: Update `oss_utils.py` to defer to the new helpers where appropriate**

Do not duplicate overlapping local-path heuristics after this.

**Step 5: Re-run the tests**

Run:

```bash
pytest tests/test_media_refs.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/utils/media_refs.py src/utils/oss_utils.py tests/test_media_refs.py
git commit -m "feat(media): add stable media reference helpers"
```


### Task 4: Add a unified provider media resolver

**Files:**
- Create: `src/utils/provider_media.py`
- Test: `tests/test_provider_media.py`

**Step 1: Write the failing tests**

Cover these cases:

- DashScope image input resolves local files to inline image data or temporary-file URL without OSS
- DashScope video/audio/reference-video input resolves local files to temporary-file URL without OSS
- DashScope uses OSS signed URLs when OSS is configured
- Vendor-direct Kling image input resolves local images to vendor-compatible base64
- Vendor-direct Vidu image input resolves local images to whatever the adapter supports today
- Resolver never persists transformed payloads back into project state

**Step 2: Run the test to verify it fails**

Run:

```bash
pytest tests/test_provider_media.py -q
```

Expected: FAIL because resolver does not exist yet.

**Step 3: Implement resolver interfaces**

Create a single entry point such as:

```python
resolve_media_input(ref: str, *, backend: str, modality: str, uploader=None) -> str
resolve_media_inputs(refs: list[str], *, backend: str, modality: str, uploader=None) -> list[str]
```

Rules:

- `local_only` plus DashScope image => inline `data:image/...`
- `local_only` plus DashScope audio/video/reference video => DashScope temporary file URL
- `local_plus_oss` => OSS upload plus signed URL when the provider expects URL
- `vendor` plus Kling image => vendor base64 format
- `vendor` plus unsupported local media => raise clear error with next-step guidance

**Step 4: Re-run the tests**

Run:

```bash
pytest tests/test_provider_media.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/utils/provider_media.py tests/test_provider_media.py
git commit -m "feat(media): add provider-aware media resolver"
```


### Task 5: Refactor image generation to use the unified resolver

**Files:**
- Modify: `src/models/image.py`
- Test: `tests/test_wan26_image_refs.py`
- Create: `tests/test_image_provider_media.py`

**Step 1: Write the failing regression tests**

Add coverage for:

- `wan2.6-image` with local ref image and no OSS
- `wan2.6-image` with OSS object key
- `wan2.6-image` with remote URL
- future backend selection continues to work after registry introduction

**Step 2: Run the tests to verify failures**

Run:

```bash
pytest tests/test_wan26_image_refs.py tests/test_image_provider_media.py -q
```

Expected: one or more FAILURES before refactor.

**Step 3: Replace local ad hoc resolution with the shared resolver**

Remove duplicate branches that manually decide among:

- local path
- OSS object key
- remote URL
- data URI

Keep the storage behavior unchanged. Only request input preparation should change.

**Step 4: Re-run the tests**

Run:

```bash
pytest tests/test_wan26_image_refs.py tests/test_image_provider_media.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/models/image.py tests/test_wan26_image_refs.py tests/test_image_provider_media.py
git commit -m "refactor(image): route provider media inputs through shared resolver"
```


### Task 6: Refactor DashScope video generation to work without OSS

**Files:**
- Modify: `src/models/wanx.py`
- Modify: `src/apps/comic_gen/pipeline.py`
- Test: `tests/test_wanx_media_fallback.py`

**Step 1: Write the failing tests**

Cover:

- I2V with local input image and no OSS
- sound-driven I2V with local audio and no OSS
- R2V with local reference videos and no OSS
- existing OSS path still works

**Step 2: Run the test to verify it fails**

Run:

```bash
pytest tests/test_wanx_media_fallback.py -q
```

Expected: FAIL because `wanx.py` still hard-fails on local media without OSS.

**Step 3: Refactor `WanxModel.generate()`**

Replace the hardcoded OSS-only branches with shared media resolution:

- image input via `resolve_media_input(..., backend="dashscope", modality="image")`
- audio input via `resolve_media_input(..., backend="dashscope", modality="audio")`
- reference videos via `resolve_media_inputs(..., backend="dashscope", modality="reference_video")`

**Step 4: Normalize `pipeline.py` task processing**

Before sending inputs into adapters, resolve local project refs to stable local absolute paths only. Do not make provider-specific transport decisions in `pipeline.py`.

**Step 5: Re-run the tests**

Run:

```bash
pytest tests/test_wanx_media_fallback.py -q
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/models/wanx.py src/apps/comic_gen/pipeline.py tests/test_wanx_media_fallback.py
git commit -m "fix(video): support DashScope media fallback without OSS"
```


### Task 7: Keep vendor-direct Kling and Vidu working behind the same routing layer

**Files:**
- Modify: `src/models/kling.py`
- Modify: `src/models/vidu.py`
- Modify: `src/apps/comic_gen/pipeline.py`
- Test: `tests/test_kling_provider_routing.py`
- Test: `tests/test_vidu_provider_routing.py`

**Step 1: Write the failing routing tests**

Cover:

- when `KLING_PROVIDER_MODE=vendor`, Kling adapter uses vendor auth only
- when `VIDU_PROVIDER_MODE=vendor`, Vidu adapter uses vendor auth only
- when provider mode is `dashscope`, project does not require vendor credentials
- direct-vendor adapters still support local image input when technically possible

**Step 2: Run the tests to verify failures**

Run:

```bash
pytest tests/test_kling_provider_routing.py tests/test_vidu_provider_routing.py -q
```

Expected: FAIL because routing is not yet centralized.

**Step 3: Refactor adapter selection**

Move model-backend choice out of scattered `if model_prefix in ...` branches and into the provider registry.

Preserve the option to keep direct vendor calls available:

- `dashscope` path for unified calling
- `vendor` path for original-provider calling with `KLING_*` or `VIDU_*`

**Step 4: Re-run the tests**

Run:

```bash
pytest tests/test_kling_provider_routing.py tests/test_vidu_provider_routing.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/models/kling.py src/models/vidu.py src/apps/comic_gen/pipeline.py tests/test_kling_provider_routing.py tests/test_vidu_provider_routing.py
git commit -m "feat(video): add provider routing for vendor-direct adapters"
```


### Task 8: Make OSS optional in the frontend configuration UX

**Files:**
- Modify: `frontend/src/components/project/EnvConfigDialog.tsx`
- Modify: `frontend/src/components/EnvConfigChecker.tsx`
- Modify: `frontend/src/components/settings/SettingsPage.tsx`
- Modify: `frontend/src/__tests__/endpoint-config.test.ts`
- Test: `frontend/src/__tests__/endpoint-config.test.ts`

**Step 1: Write the failing frontend tests**

Update tests to reflect the new rule:

- only `DASHSCOPE_API_KEY` is globally required for the default DashScope-first experience
- OSS fields are optional
- vendor credentials are optional unless the user explicitly selects vendor-direct routing
- config normalization preserves provider-mode fields and endpoint overrides

**Step 2: Run the test to verify it fails**

Run:

```bash
cd frontend && npm test -- --runInBand src/__tests__/endpoint-config.test.ts
```

Expected: FAIL because the current validation still requires OSS fields.

**Step 3: Refactor config validation**

Update the dialog and checker so required fields depend on route mode:

- always require `DASHSCOPE_API_KEY`
- require `KLING_ACCESS_KEY` and `KLING_SECRET_KEY` only if Kling mode is `vendor`
- require `VIDU_API_KEY` only if Vidu mode is `vendor`
- never require OSS to open or use the app

**Step 4: Re-run the test**

Run:

```bash
cd frontend && npm test -- --runInBand src/__tests__/endpoint-config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/components/project/EnvConfigDialog.tsx frontend/src/components/EnvConfigChecker.tsx frontend/src/components/settings/SettingsPage.tsx frontend/src/__tests__/endpoint-config.test.ts
git commit -m "fix(frontend): make OSS optional in environment setup"
```


### Task 9: Add end-to-end backend verification for local-only mode

**Files:**
- Create: `tests/test_local_only_flow.py`
- Modify: `tests/conftest.py` if needed

**Step 1: Write a failing local-only flow test**

Simulate a project with:

- DashScope key configured
- OSS not configured
- local uploaded image
- local generated image
- local storyboard render
- local video task creation

Mock provider HTTP calls so the test verifies media preparation, not external network behavior.

**Step 2: Run the test to verify it fails**

Run:

```bash
pytest tests/test_local_only_flow.py -q
```

Expected: FAIL before all refactors are complete.

**Step 3: Complete any missing glue**

Fix remaining boundary issues where code still assumes:

- only `http` means remotely usable
- non-`http` media must be OSS-backed
- local refs cannot be passed into audio/video generation

**Step 4: Re-run the test**

Run:

```bash
pytest tests/test_local_only_flow.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/test_local_only_flow.py tests/conftest.py
git commit -m "test(flow): verify local-only media pipeline without OSS"
```


### Task 10: Run full verification and update operational docs

**Files:**
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `USER_MANUAL.md`
- Test: full repo tests

**Step 1: Update docs**

Document these supported modes:

- DashScope-only, no OSS
- DashScope plus OSS
- DashScope-first with vendor-direct override for Kling
- DashScope-first with vendor-direct override for Vidu

Include exact required env vars for each mode.

**Step 2: Run backend verification**

Run:

```bash
HOME=/tmp/omni_studio-test-home pytest tests -q
```

Expected: PASS.

**Step 3: Run frontend verification**

Run:

```bash
cd frontend && npm test -- --runInBand src/__tests__/endpoint-config.test.ts
```

Expected: PASS.

**Step 4: Run targeted lint or formatting checks that exist in the environment**

Run only tools available in the current environment. Do not block the ship on missing tools.

**Step 5: Commit**

```bash
git add README.md README_EN.md USER_MANUAL.md
git commit -m "docs: explain DashScope-first and no-OSS operating modes"
```


### Task 11: Optional follow-up for Pixverse once the DashScope contract lands

**Files:**
- Modify: `src/utils/provider_registry.py`
- Modify: `frontend/src/store/projectStore.ts`
- Test: `tests/test_provider_registry.py`

**Step 1: Add the model family to the registry**

Do not invent transport behavior. Add only after the exact DashScope contract exists.

**Step 2: Add UI model options**

Expose Pixverse only if backend support is fully wired.

**Step 3: Re-run the registry tests**

Run:

```bash
pytest tests/test_provider_registry.py -q
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/utils/provider_registry.py frontend/src/store/projectStore.ts tests/test_provider_registry.py
git commit -m "feat(video): register pixverse provider routing"
```
