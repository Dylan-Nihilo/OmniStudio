# Qwen Audio 3.0 TTS Plus

Verified: 2026-09-10.

- Model: `qwen-audio-3.0-tts-plus`, supplied by Alibaba Cloud Model Studio.
- Voice list: https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list
- Model reference: https://help.aliyun.com/zh/model-studio/qwen-audio-3-0-tts-plus
- System voices: `longanlingxin` (female), `longanlufeng` (male); both support Mandarin and English. Voices from other model families cannot be substituted.
- The same official voice page also links 500+ model-specific basic voices; the system pair is not the full supported inventory. On 2026-09-10, the linked Plus XLSX lists `qwen-audio-3.0-tts-plus-longyujunxuan` (female, 25, 温柔坚韧音) and `qwen-audio-3.0-tts-plus-longlingzhixing` (male, 68, 浑厚沉稳音). Both are exposed through the existing registry and Web picker; they retain the Plus model and workspace WebSocket transport. Source: [official Plus basic voice list](https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260723/ydwqqz/qwen-audio-3.0-tts-plus%E5%9F%BA%E7%A1%80%E9%9F%B3%E8%89%B2.xlsx).
- Transport: `dashscope.audio.tts_v2.SpeechSynthesizer`; the installed SDK accepts `instruction` (singular), `url`, and MP3 output format.
- Credentials: reuse the Workspace's `DASHSCOPE_API_KEY`. Set `QWEN_AUDIO_TTS_BASE_URL` through the existing endpoint settings for a workspace-specific WebSocket endpoint. Pass it per synthesizer instance; do not change DashScope's process-wide WebSocket URL.
- Live smoke: the user-provided Beijing workspace endpoint returned a valid 24 kHz mono MP3 for `longanlingxin`; 3.888 seconds of audio. The desktop Web voice picker also generated and played a separate 5.664-second preview through the production adapter (`POST /voice/preview` 200, media GET 206). This proves synthesis, not finished-film voice direction or lip synchronization.
- Documentation scope: repo-local evidence only; promotion to the external raw-doc archive and Context Hub remains pending.
- Billing integration (2026-09-14): synthesis requires a published `tts/qwen-audio-3.0-tts-plus` price when billing is enabled. An unpriced voice is rejected before contacting the provider; this merge does not invent a supplier price.
