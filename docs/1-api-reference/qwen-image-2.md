# Qwen Image 2.0 transport

Verified 2026-09-10 against Aliyun's [generation API](https://help.aliyun.com/zh/model-studio/qwen-image-api)
and [editing API](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api).

`qwen-image-2.0-pro` and `qwen-image-2.0` use synchronous
`POST /api/v1/services/aigc/multimodal-generation/generation` for both text-to-image
and editing. Do not send `X-DashScope-Async`. The successful response contains
`output.choices[].message.content[].image`, rather than a task ID.

Send one user message containing up to three ordered image items (URLs or Base64
data URIs) followed by one text item. Reference order is meaningful. Images are
limited to 10 MB each. Output pixels must total between 512² and 2048²; `n` is 1–6.
The adapter retains its single-image return contract, with candidate batching
handled by the existing asset generator.

The three-input limit is enforced before dispatch. Never truncate references:
the fourth input may contain a story-critical prop. For larger compositions,
prepare the scene-state image first, then use it with the character references.

Wan 2.7 retains its separate asynchronous endpoint and task polling.
This is a repository-local reference; the shared vendor archive has not been updated.
