# SRC-09 验收说明

## 交付范围

- Source 正文产生新 revision 时，在同一数据库事务中创建 `SourceRevisionImpact` 影响事件；章节初始导入不产生影响事件。
- `PATCH/PUT /sources/{source_id}/chapters/{chapter_id}` 的正文编辑、`POST .../revisions` 新建 revision 和 `POST .../restore` 恢复 revision 均记录新旧 revision、变更类型和创建人。
- 影响事件为可追溯快照，目标按 `script`、`shot`、`downstream` 分类，统一标记为 `needs_review`；目标包含 Episode、Shot ID、下游阶段和必要的展示 metadata。
- 已绑定 Source 的 Episode 会产生 Script 与 production downstream 标记；其 Script payload 中的 frames 会产生 Shot/storyboard 与 generation downstream 标记。
- 提供 Source 级和章节级查询接口，支持按 `chapter_id`、`revision_id` 筛选；所有事件和目标均带 Workspace 归属，跨 Workspace 访问返回标准 `AUTH_RESOURCE_NOT_FOUND`。
- 影响账本独立于 Script JSON 保存，不覆盖现有 Script/Shot 内容，也不把 stale 状态仅留在前端；后续负责人可基于 `status` 接入复核确认流程。

## API 示例

```text
PUT /sources/{source_id}/chapters/{chapter_id}
    {"content":"修订后的章节正文"}

GET /sources/{source_id}/impact-events
GET /sources/{source_id}/impact-events?chapter_id={chapter_id}
GET /sources/{source_id}/impact-events?revision_id={revision_id}
GET /sources/{source_id}/chapters/{chapter_id}/impact-events
```

兼容查询路径：

```text
GET /sources/{source_id}/impacts
GET /sources/{source_id}/chapters/{chapter_id}/impacts
```

响应核心字段：

```json
{
  "items": [{
    "revision_number": 2,
    "previous_revision_number": 1,
    "change_type": "chapter_edit",
    "status": "open",
    "target_count": 4,
    "targets": [
      {"target_type":"script","status":"needs_review"},
      {"target_type":"shot","target_stage":"storyboard","status":"needs_review"},
      {"target_type":"downstream","target_stage":"generation","status":"needs_review"}
    ]
  }],
  "total": 1
}
```

## 验收数据与测试

专项测试覆盖固定 Source、1 个章节、1 个已绑定 Episode 和 1 个 Shot，验证：

- 初始章节创建及仅修改标题不会产生影响事件；
- 正文 revision 产生可查询的影响事件，并标记 Script、Shot 和 downstream；
- 影响事件携带当前/前一 revision 信息，按章节和 revision 查询结果正确；
- 恢复历史 revision 会产生 `revision_restore` 新事件；
- schema 表、约束和索引已纳入回归断言。

验证命令：

```bash
OMNI_STUDIO_AUTH_SIGNING_SECRET=test-signing-secret-012345678901234567890123456789 \
  .venv/bin/pytest -q tests/test_source_domain.py tests/test_storage_schema.py
```

验收结果：`25 passed`；全量后端回归：`593 passed`。
