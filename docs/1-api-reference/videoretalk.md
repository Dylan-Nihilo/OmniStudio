# DashScope VideoRetalk

- Source: https://help.aliyun.com/zh/model-studio/videoretalk-api
- Captured: 2026-09-11
- Model: `videoretalk`; provider: Alibaba Cloud DashScope, Beijing region.
- Scope: replace mouth motion in an existing video using clean speech audio.
- Repo-only documentation mirror; external archive/Context Hub promotion is not included.

POST `/api/v1/services/aigc/image2video/video-synthesis` with `model`,
`input.video_url`, `input.audio_url`, and `parameters.video_extension=false`.
Use bearer authentication, `X-DashScope-Async: enable`, and
`X-DashScope-OssResourceResolve: enable` for provider temporary `oss://` inputs.
Poll `/api/v1/tasks/{task_id}`; download `output.video_url` after `SUCCEEDED`.

Video and clean speech must each be longer than 2 seconds and shorter than
120 seconds. Video edges must be 640–2048 pixels at 15–60 fps. The intended
input is a frontal close-up. With multiple faces, the default target is the
largest face in the first frame containing faces; an optional face reference
can select another target. Studio resolves the explicit dialogue speaker and sends
that character’s selected headshot as `input.ref_image_url`. Multiple-character
shots require this reference; it can be uploaded in the voice workbench.
The provider does not promise animation-specific quality; inspect actual output.

Studio pads the clean TTS track to the clip duration, including its explicit
start offset. Video extension stays disabled so the service cannot loop the
picture backward. The preview retains the existing voice/background mix, and
publication still requires the existing Apply action. Original takes remain.

H3 post-production keeps its first-frame mode; it no longer silently enables
reference audio. Lip synchronization is a separate, previewed processing step.
The task and provider ID are persisted for recovery. DashScope OSS result URLs
use HTTPS while keeping their signed query intact.

When workspace billing is enabled, this operation uses its own `videoretalk`
price and measured input duration, including any video padding for a negative
audio offset. A missing price blocks submission; the source video's model price
is never reused. This integration does not seed an unverified supplier price.
