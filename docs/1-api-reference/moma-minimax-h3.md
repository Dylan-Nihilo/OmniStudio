# MOMA MiniMax H3 Video API

- Source URL: `https://moma.cmecloud.cn/v1/videos`
- Captured: 2026-09-07
- Provider/family/model: MOMA / MiniMax / `minimax/minimax-h3`
- Scope: asynchronous text/image/video/audio-conditioned video submission and polling

## Request contract

`POST https://moma.cmecloud.cn/v1/videos` uses `Authorization: Bearer <API_KEY>`
and a JSON body containing `model`, a `content` array with a text item, and
`resolution`, `duration`, and `ratio` parameters. The response returns
`task_id`.

The first `content` item is text. Image-, video-, and audio-conditioned generation
append one or more `image_url`, `video_url`, or `audio_url` items to the same array.
Omni Studio exposes the same `minimax/minimax-h3` model in T2V, I2V, R2V, and
V2V flows; the API model ID does not change between those input combinations.

Local media must be uploaded to an externally reachable URL before submission.
The Studio integration uses configured OSS storage to upload and sign local files;
remote HTTPS media URLs can be forwarded directly.

## Poll contract

`GET https://moma.cmecloud.cn/v1/videos/{task_id}` requires both the bearer
token and `X-Model-Name: minimax/minimax-h3`. A successful response has
`task.status = SUCCEEDED` and `task.content.url`; failed responses use
`task.status = FAILED`.

The API key is intentionally not recorded in this document or in repository
configuration. Configure it through the workspace settings as `MOMA_API_KEY`.
