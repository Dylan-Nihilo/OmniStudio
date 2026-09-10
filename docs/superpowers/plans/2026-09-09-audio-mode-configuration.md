# 视频音频模式与可选配置改造计划

## 目标

统一视频任务的音频语义，让项目和镜头可以明确选择“静音、模型原生、外部驱动、后期混音”，并把选择稳定地映射到不同 provider 的参数。旧版 `generate_audio`、`audio_url`、`sound`、`vidu_audio` 字段继续可读写，避免历史项目失效。

## 目标状态

| 模式 | 视频模型阶段 | 后期阶段 | 约束 |
| --- | --- | --- | --- |
| `silent` | 明确关闭 provider 音频 | 可选 TTS/SFX/BGM | 不发送驱动音频 |
| `native` | 明确打开 provider 原生音频 | 可继续混音 | 仅限 provider 支持的模型 |
| `driven` | 使用 `audio_url` 驱动 | 可继续混音 | 必须提供音频，且模型支持驱动 |
| `post` | 明确关闭 provider 音频 | TTS/SFX/BGM 负责最终声音 | 默认正式生产模式 |

默认策略：正式生产使用 `post`，快速预览使用 `native`，口型同步/演唱使用 `driven`，明确无声时使用 `silent`。

## 实施步骤

1. **统一数据契约**
   - 在后端增加 `AudioMode` 和 `VideoTask.audio_mode`。
   - 在创建任务请求和前端 `VideoTask`/`ParamsState` 增加可选 `audio_mode`。
   - 新字段优先；缺失时按旧字段推导：`audio_url` → `driven`，`generate_audio=true` → `native`，否则 → `silent`。
   - 验收：历史 JSON 可加载，新旧请求均能创建任务。

2. **集中 provider 能力映射**
   - 增加单一解析器，将模式转换为 `audio_url`、`audio`、Kling `sound`、Vidu `audio` 等参数。
   - Wan 2.5/2.6 不再硬编码 `audio=True`；`silent`/`post` 必须真正传 `False`。
   - 对不支持的模式返回 400 和可读原因，不静默忽略。
   - 验收：定向单元测试覆盖四种模式、Wan payload 和不支持组合。

3. **前端可选配置**
   - 在镜头参数区增加音频模式选择，默认 `post`。
   - `driven` 仅显示并校验驱动音频入口；其它模式不要求 `audio_url`。
   - 保留 Kling/Vidu 的专属参数作为 provider 高级配置，并在模式切换时同步默认值。
   - 验收：类型检查、组件测试、刷新后配置仍可恢复。

4. **后期音频链路补齐**
   - 继续复用现有 Dialogue TTS、dubbing 和 BGM 逻辑。
   - [x] 将 `frame.sfx_url` 纳入最终 FFmpeg 混音，按累计镜头时间偏移和音量合并。
   - [x] BGM 预设通过 `available` 标记缺失资源；未配置 provider 时明确报错，不能生成伪造的可发布音频。
   - 验收：有/无视频原生音频时均能生成正确混音；缺少 ffmpeg 时返回可诊断错误。

5. **回归与发布门禁**
   - 后端：`pytest -q`，至少包含音频模式定向测试。
   - 前端：`npm run typecheck`、`npm run test -- --run`、`npm run build`。
   - 检查敏感信息和工作流镜像后，再按项目 Git 发布流程提交独立 Conventional Commit。

## 依赖与风险

- provider 对“原生音频”的支持会随模型版本变化，能力表必须可扩展。
- FFmpeg/ffprobe 未安装时无法做真实混音验收，测试应使用 mock 或明确跳过并报告环境依赖。
- 旧任务没有 `audio_mode`，读取时必须走兼容推导，不能批量改写用户数据。
