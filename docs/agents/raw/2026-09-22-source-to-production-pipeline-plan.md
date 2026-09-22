# 来源资料到完整生产流程实施记录

## 目标

来源资料导入、章节分析、拆集后的 Episode 必须进入工作区已有的完整制作链：剧本写作与保存 → 实体分析 → 美术/角色资产 → 制作规划与分镜 → 视频 → 配音 → 合成导出。来源页默认生成竖屏 9:16 的 R2V Episode。

## 采用的边界

- 来源资料仍由 SourceRepository 保存来源、章节、修订、分析和关联关系。
- 来源页只做资料管理、分析、章节/集关联和生产入口；生产数据全部存入现有 Script/Series/Pipeline。
- 所有生产入口使用 `#/project/{episode_id}`，由 `ProjectClient` 提供统一工作区体验；独立脚本编辑器不再作为正式生产入口。
- 来源分析结果作为只读参考。剧本改写必须经过已有 ScriptWritingEditor 的预览、人工接受和 CAS 保存，再使用既有实体提取与制作规划流程。
- 不把分析事件直接伪造成镜头、场景或视频任务；镜头必须由现有分镜/制作规划流程生成并通过其校验。

## 已实现

1. `GET /episodes/{episode_id}/production-context` 提供来源依赖、修订影响、实际生产阶段、真实资产/分镜/视频/音频计数、父级 Series ID 和有效画幅。
2. 来源拆集确认调用 `create_series_from_import(..., workflow_mode="r2v", aspect_ratio="9:16")`，并把 Series 配置继承给每个 Episode。普通旧导入保持原默认行为。
3. 来源拆集确认后，能够按正文匹配章节建立 `SourceChapterEpisodeLink`；没有可靠匹配时保留文档级兼容关联。
4. 生产上下文通过 `resolve_episode_assets` 统计 Episode、Series、全局库合并后的资产；视频完成状态要求每个分镜都有完成视频；无对白剧集不会被音频阶段卡住。
5. 视频任务创建时持久化有效 `storyboard_aspect_ratio`，并将该比例传给 Wan/Kling/Vidu/Seedance 等下游适配器。
6. 来源页“打开剧本/进入生产”统一进入 `ProjectClient`；工作区剧本参考栏展示关联来源章节、版本变更提示。

## 验收顺序

1. 导入 TXT/Markdown/DOCX 或粘贴正文，确认章节预览后确认来源导入。
2. 来源分析完成后检查事件结果、状态和可重试行为；编辑章节会产生新 revision 并标记影响项。
3. 生成拆集预览，人工修正标题/边界，确认后检查 Series、Episode、章节关联和 9:16/R2V 设置。
4. 从来源页打开任意 Episode，确认进入同一个 ProjectClient，并依次完成剧本保存、实体提取、资产、分镜、视频、配音、合成导出。
5. 修改来源章节后返回工作区，确认来源参考显示 stale；人工核对后再改写剧本，不自动覆盖人工内容。
6. 检查每个视频任务的 ratio 为 9:16，导出分辨率/方向保持工作区设置。

## 已知限制

- 真实模型生成、TTS、FFmpeg 和 OSS 结果取决于部署环境配置；自动化测试使用 provider mock，不声称生成真实成片。
- 已有历史 Episode 不会被静默改成 R2V/9:16，仍按其实际有效配置进入工作区；只有来源拆集新建 Episode 使用来源流程默认值。
