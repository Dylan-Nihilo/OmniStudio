# MOMA MiniMax H3 Video API

The platform's current MiniMax route is JojoKey MiniMax A. The MOMA contract
below is retained for the legacy adapter; its sizes, durations and reference
limits do not override the active MiniMax A catalog configuration.

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

Local images can be submitted as Base64 data URIs; OSS is optional. When configured,
the existing uploader can still provide signed URLs. Remote HTTPS media URLs pass
through directly. Media items use nested objects, for example
`{"type":"image_url","image_url":{"url":"data:image/png;base64,..."},"role":"first_frame"}`.
R2V uses `reference_image`, `reference_video`, and `reference_audio` roles.

Studio's video-task API also accepts optional `last_frame_url` with a first image
in H3 I2V mode. It snapshots local ending images and sends `role=last_frame`;
reference image/video/audio inputs cannot be combined with this option. Saved
task retries retain both image inputs. This API capability does not yet have a
dedicated ending-image picker in the Studio frontend.

Rechecked 2026-09-11: the official V2 contract makes first/last-frame generation
and multimodal reference generation mutually exclusive. Any `reference_audio`
item requires reference mode for the images too; it cannot be combined with
`first_frame`. The existing adapter therefore sends dialogue-conditioned shots
as `reference_image` + `reference_audio`, even when Studio prepares an image
through its first-frame workflow. This preserves voice guidance but does not
lock the opening composition. The Web hint states this tradeoff.

Verified 2026-09-10 against the [official MiniMax V2 reference](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)
and a real MOMA request: a local PNG submitted as a data URI produced a downloadable
5-second 2K video, task `440245382861220`. The supported duration is 4–15 seconds;
resolution options are `768P` and `2K`; reference images are limited to nine,
30 MB each, and the complete request must fit within 64 MB. Local video transport
remains URL-based in this adapter. Audio supports WAV/MP3 data URIs, up to 15 MB.
MOMA rejects the standard `audio/mpeg` subtype as an unsupported `.mpeg` file;
the adapter normalizes MP3 data URIs to `audio/mp3`.

Real Web validation on 2026-09-10: task `440300834169252` accepted a local Qwen
dialogue MP3 without OSS and returned a 2K video. The spoken text was correct,
but its start moved to about 3.46 seconds and early mouth movement remained.
Treat this as audio reference, not deterministic lip sync. These takes require
explicit shot review before export. The rejected MIME test is task `440298079584689`.

## Poll contract

`GET https://moma.cmecloud.cn/v1/videos/{task_id}` requires both the bearer
token and `X-Model-Name: minimax/minimax-h3`. A successful response has
`task.status = SUCCEEDED` and `task.content.url`; failed responses use
`task.status = FAILED`.

The API key is intentionally not recorded in this document or in repository
configuration. Configure it through the workspace settings as `MOMA_API_KEY`.
