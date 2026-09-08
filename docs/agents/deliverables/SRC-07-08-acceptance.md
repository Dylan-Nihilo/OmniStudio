# SRC-07 / SRC-08 验收说明

## 交付范围

- `POST /sources/{source_id}/chapters/{chapter_id}/analysis` 对当前 Source revision 进行结构化章节事件分析，结果按事件顺序保存，并返回章节、revision、内容哈希、事件、状态和错误字段。
- `GET /sources/{source_id}/chapters/{chapter_id}/analysis` 查询当前章节最近一次分析；`GET .../analysis/history` 查询全部分析尝试。
- AI 异常不会丢失失败记录：写入稳定错误码和错误消息，接口返回 502，客户端可通过查询接口展示失败并调用 retry。
- `POST .../analysis/retry` 创建新的不可变分析尝试，保留 `attempt` 和 `retry_of` 关系；保存时再次校验 revision 与正文哈希，正文变化返回 409。
- `POST /sources/{source_id}/analysis/batch` 为指定章节或全部章节建立持久化批次，逐项返回成功、失败和跳过清单；已有当前 revision 的成功分析项标记为 `skipped`，不会重复调用 AI。
- `POST /sources/{source_id}/analysis/batches/{batch_id}/retry` 仅重试失败项，保留其余成功和跳过项；批次状态和计数从明细项实时汇总。
- 分析记录、批次及批次明细均带 Workspace 归属；资源路由跨 Workspace 统一返回 `AUTH_RESOURCE_NOT_FOUND`。

## API 示例

```text
POST /sources/{source_id}/chapters/{chapter_id}/analysis
      {"force": false}

GET  /sources/{source_id}/chapters/{chapter_id}/analysis
GET  /sources/{source_id}/chapters/{chapter_id}/analysis/history
POST /sources/{source_id}/chapters/{chapter_id}/analysis/retry

POST /sources/{source_id}/analysis/batch
      {"chapter_ids":["chapter-a","chapter-b"]}
GET  /sources/{source_id}/analysis/batches/{batch_id}
POST /sources/{source_id}/analysis/batches/{batch_id}/retry
      {"chapter_ids":["chapter-b"]}
```

单章 AI 失败时，HTTP 响应为 502，错误信封示例：

```json
{
  "error": {
    "code": "SOURCE_CHAPTER_ANALYSIS_FAILED",
    "message": "章节事件分析失败，请稍后重试",
    "request_id": "req_..."
  }
}
```

批量接口不会因单项失败而丢弃整个批次，响应包含 `success_items`、`failed_items`、`skipped_items`，并通过 `succeeded`、`failed`、`skipped` 和 `status` 汇总结果。

## 验收数据与测试

专项测试使用固定 1 个 Source、3 个章节和一个 Workspace，覆盖：

- 章节事件结构化结果、当前结果查询、重复分析复用和分析历史；
- AI 失败记录可查询，单章 retry 的 `attempt` / `retry_of` 正确；
- 批量分析一项成功、一项失败、一项已有分析而跳过；
- 批量失败项重试后状态与计数恢复，成功项和跳过项不重复执行；
- 批次跨 Workspace 访问被拒绝；
- 三张新增表及其索引已纳入 schema 回归断言。

验证命令：

```bash
OMNI_STUDIO_AUTH_SIGNING_SECRET=test-signing-secret-012345678901234567890123456789 \
  .venv/bin/pytest -q tests/test_source_domain.py tests/test_storage_schema.py
```

验收结果：`24 passed`。
