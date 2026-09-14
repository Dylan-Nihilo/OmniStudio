# Qwen Image 3.0 Pro

Verified 2026-09-11 against Aliyun's [model information](https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro)
and [generation/editing API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference).
Provider: Alibaba Cloud Bailian. Model ID: `qwen-image-3.0-pro`.

The existing Qwen adapter uses synchronous DashScope
`POST /api/v1/services/aigc/multimodal-generation/generation`.
Text-only and 1–3 ordered image inputs share this endpoint. The response image is
in `output.choices[].message.content[].image`; no polling is needed.
Existing DashScope credentials and region-matched base URL apply.

Output area is 512²–2048² pixels, with aspect ratio 1:8–8:1.
The existing `size`, `n`, `negative_prompt`, `seed`, `prompt_extend`, and
`watermark` parameters remain valid. New optional thinking and prompt-extension
mode parameters retain provider defaults; no extra UI controls or transport fork.

This is a repository-local reference. The shared vendor archive and Context Hub
package have not been updated.
