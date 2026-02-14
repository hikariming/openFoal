# Auth & Tenant Test Plan

状态：ACTIVE  
适用范围：Enterprise Auth（local/external/hybrid）

## 1. 范围与非范围

范围：

1. `connect` 鉴权门禁与错误码。
2. JWT 校验（local HS256 / external JWKS RS256）。
3. 作用域收口（tenant/workspace）与 RBAC（三角色）。
4. `auth` HTTP 接口（`/auth/login` `/auth/refresh` `/auth/me` `/auth/logout`）。

非范围：

1. 复杂组织树与细粒度权限树。
2. 外部 IdP 页面级 SSO 跳转流程。
3. mTLS、证书轮换、风控设备指纹。

## 2. 测试分层

1. 契约测试（CT）：协议与错误码稳定性。
2. 单元测试（UT）：token 校验、claim 映射、role 判定。
3. 集成测试（IT）：gateway + storage + auth 接口联动。
4. 端到端（E2E）：web-console 登录与治理路径权限验证。

## 3. 环境与数据准备

1. 默认租户：`t_default` / code=`default`。
2. 默认管理员（local/hybrid）：`admin/admin123!`。
3. external 模式需可访问 JWKS 测试端点。

## 4. 用例清单（首批）

1. `AUTH-CT-001`：`mode=none`，`connect` 无 token 成功。
2. `AUTH-CT-002`：`mode=external`，`connect` 无 token 返回 `AUTH_REQUIRED`。
3. `AUTH-CT-003`：无效签名 token 返回 `UNAUTHORIZED`。
4. `AUTH-CT-004`：有效 external token 可调用读接口，`member` 调用 `policy.update` 返回 `FORBIDDEN`。
5. `AUTH-UT-001`：JWKS key rotation 时新 `kid` 可命中。
6. `AUTH-UT-002`：claim 映射（`sub/tenantId/roles`）正确。
7. `AUTH-UT-003`：tenant/workspace 越权返回 scope mismatch。
8. `AUTH-UT-004`：三角色矩阵判定正确。
9. `AUTH-IT-001`：external 首登懒同步 `users/auth_identities`。
10. `AUTH-IT-002`：`workspace_admin` 仅可改本 workspace。
11. `AUTH-IT-003`：`tenant_admin` 可改全租户。
12. `AUTH-IT-004`：`audit.query` 仅返回授权范围。
13. `AUTH-E2E-001`：企业登录后完成首条 `agent.run`。
14. `AUTH-E2E-002`：tenant 切换后数据隔离。
15. `AUTH-E2E-003`：角色降权后下次请求立即生效。

## 5. 回归清单与发布门禁

1. 基线：`npm run test:auth`。
2. 全后端回归：`npm run test:backend`。
3. Docker 企业冒烟：`npm run test:p2:e2e:docker`。
4. 触达 auth 代码的 PR 必须绑定至少 1 个 `AUTH-*` 用例编号。

当前自动化落地（2026-02-14）：

1. `AUTH-CT-001~004`：已落地（`tests/backend/gateway.auth.test.mjs`）。
2. `AUTH-UT-001~004`：已落地（`tests/backend/gateway.auth.test.mjs`）。
3. `AUTH-IT-*`、`AUTH-E2E-*`：待后续迭代补齐。
