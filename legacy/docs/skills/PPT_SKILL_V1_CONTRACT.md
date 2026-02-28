# OpenFoal PPT Skill V1 Contract

状态：ACTIVE

## 1. Skill ID 与触发

1. Skill ID: `openfoal-ppt-v1`
2. Invocation: `/skill:openfoal-ppt-v1 <json-args>`

示例：

```text
/skill:openfoal-ppt-v1 {"title":"QBR 2026","slides":8,"lang":"zh-CN","out":"./.openfoal/output/qbr-2026.pptx"}
```

## 2. Args Schema（文档约定）

`PptSkillArgs`:

1. `title: string`
2. `slides: number`（范围 `3-30`）
3. `lang: "zh-CN" | "en-US"`
4. `out: string`
5. `theme?: string`

默认值：

1. `title = "OpenFoal Deck"`
2. `slides = 8`
3. `lang = "zh-CN"`
4. `out = "./.openfoal/output/demo.pptx"`

## 3. 输出产物

1. 主产物：`${out}`，必须是可打开的 `.pptx` 文件。
2. 元数据：`${out}.meta.json`。

`PptArtifactMeta`:

1. `skillId: "openfoal-ppt-v1"`
2. `engine: "pptxgenjs"`
3. `slideCount: number`
4. `title: string`
5. `outputPath: string`
6. `checksum: string`（sha256）
7. `generatedAt: string`（ISO 时间）

## 4. 运行策略

1. 个人版与企业版使用同一 `/skill:` 预处理和执行链。
2. 企业生产默认 `bundle_only`，仅允许 `skills.bundle.import + skills.install`。
3. V1 不做审批流，不做公网镜像仓。

## 5. 错误映射

1. 模型不可用：`MODEL_UNAVAILABLE`
2. 工具/脚本执行失败：`TOOL_EXEC_FAILED`
3. 未安装 skill、入口缺失、非法请求：`INVALID_REQUEST`

## 6. 依赖约束

1. 生成引擎固定：`Node + pptxgenjs`
2. 不做运行时自动依赖安装。
3. 依赖由个人环境或企业镜像预置。
