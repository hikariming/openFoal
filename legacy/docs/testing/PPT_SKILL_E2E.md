# PPT Skill E2E

状态：ACTIVE
适用范围：P1 / P2

## 1. 目标

验证 `openfoal-ppt-v1` 在个人版和企业版都可通过同一链路完成：

1. `bundle.import -> skills.install`
2. `/skill:openfoal-ppt-v1 {json}`
3. 产出有效 `.pptx` 与 `.meta.json`

## 2. 前置条件

1. 网关已启动（默认 `http://127.0.0.1:8787`）。
2. 模型 key 已配置（`secrets.getModelKeyMeta` 可返回至少 1 条）。
3. 环境已安装 `pptxgenjs`。

## 3. 脚本

使用脚本：`/Users/rqq/openFoal/scripts/skill-ppt-e2e.mjs`

示例：

```bash
node scripts/skill-ppt-e2e.mjs --mode personal --gateway http://127.0.0.1:8787
node scripts/skill-ppt-e2e.mjs --mode enterprise --gateway http://127.0.0.1:8787 --tenant t_default --workspace w_default
```

## 4. 用例编号

1. `PPT-E2E-001` 个人：bundle 导入、安装、触发、产物校验。
2. `PPT-E2E-002` 企业：同链路 + scope 参数校验。
3. `PPT-E2E-003` 企业 `bundle_only`：在线 refresh/install 阻断，bundle install 可用。
4. `PPT-E2E-004` 离线演练：复用 bundle 与已装 skill（要求具备可离线模型环境）。

## 5. 校验规则（严格 PPTX）

1. 输出文件存在且大小 > 0。
2. 文件头为 ZIP 魔数 `PK`。
3. ZIP entries 包含 `[Content_Types].xml`。
4. ZIP entries 至少包含一个 `ppt/slides/slide*.xml`。
5. `${out}.meta.json` 与请求参数一致：`skillId/engine/slideCount/title/outputPath`。
