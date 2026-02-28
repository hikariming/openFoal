import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";

import { createConnectionState, createGatewayRouter } from "../../apps/gateway/dist/index.js";
import { createGatewayAuthRuntime } from "../../apps/gateway/dist/auth.js";
import { InMemoryAuthStore } from "../../packages/storage/dist/index.js";

function req(id, method, params = {}) {
  return {
    type: "req",
    id,
    method,
    params
  };
}

test("AUTH-CT-001 connect in none mode works without token", async () => {
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "none",
      enterpriseRequireAuth: false,
      localJwtSecret: "s",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store: new InMemoryAuthStore()
  });
  const router = createGatewayRouter({
    authRuntime: runtime
  });
  const state = createConnectionState();
  const connected = await router.handle(req("r_connect", "connect", {}), state);
  assert.equal(connected.response.ok, true);
});

test("AUTH-CT-002 external mode requires token", async () => {
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "external",
      enterpriseRequireAuth: true,
      localJwtSecret: "s",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      jwksUrl: "http://127.0.0.1:1/invalid",
      jwtIssuer: "aipt5",
      jwtAudience: "openfoal-enterprise",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store: new InMemoryAuthStore()
  });
  const router = createGatewayRouter({
    authRuntime: runtime
  });
  const state = createConnectionState();
  const connected = await router.handle(req("r_connect", "connect", {}), state);
  assert.equal(connected.response.ok, false);
  if (!connected.response.ok) {
    assert.equal(connected.response.error.code, "AUTH_REQUIRED");
  }
});

test("AUTH-CT-003 invalid signature is rejected", async () => {
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "local",
      enterpriseRequireAuth: true,
      localJwtSecret: "secret_A",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store: new InMemoryAuthStore()
  });
  const router = createGatewayRouter({
    authRuntime: runtime
  });
  const state = createConnectionState();
  const invalidToken = signHs256(
    {
      sub: "u_x",
      tenantId: "t_default",
      workspaceIds: ["w_default"],
      roles: ["member"],
      iss: "openfoal-local",
      aud: "openfoal",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    "secret_B"
  );
  const connected = await router.handle(
    req("r_connect", "connect", {
      auth: {
        token: invalidToken
      }
    }),
    state
  );
  assert.equal(connected.response.ok, false);
  if (!connected.response.ok) {
    assert.equal(connected.response.error.code, "UNAUTHORIZED");
  }
});

test("AUTH-CT-004 valid external JWT works and member is forbidden on policy.update", async (t) => {
  const keyPair = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const publicJwk = keyPair.publicKey.export({
    format: "jwk"
  });
  const jwk = {
    ...publicJwk,
    kid: "k1",
    use: "sig",
    alg: "RS256"
  };

  const jwksServer = await startJwksServer({
    keys: [jwk]
  }, t);
  if (!jwksServer) {
    return;
  }
  try {
    const runtime = createGatewayAuthRuntime({
      config: {
        mode: "external",
        enterpriseRequireAuth: true,
        localJwtSecret: "s",
        localJwtExpiresSec: 3600,
        localIssuer: "openfoal-local",
        localAudience: "openfoal",
        defaultTenantCode: "default",
        defaultWorkspaceId: "w_default",
        defaultAdminUsername: "admin",
        defaultAdminPassword: "admin123!",
        jwksUrl: `${jwksServer.baseUrl}/.well-known/jwks.json`,
        jwtIssuer: "aipt5",
        jwtAudience: "openfoal-enterprise",
        externalRoleMap: {
          ADMIN: "tenant_admin",
          USER: "member"
        }
      },
      store: new InMemoryAuthStore()
    });

    const router = createGatewayRouter({
      authRuntime: runtime
    });
    const state = createConnectionState();
    const token = signRs256(
      {
        sub: "aipt5-user-001",
        tenantId: "t_ext",
        workspaceIds: ["w_default"],
        roles: ["USER"],
        username: "portal-user",
        iss: "aipt5",
        aud: "openfoal-enterprise",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      {
        kid: "k1",
        privateKeyPem: keyPair.privateKey.export({
          type: "pkcs8",
          format: "pem"
        })
      }
    );

    const connected = await router.handle(
      req("r_connect", "connect", {
        auth: {
          token
        }
      }),
      state
    );
    assert.equal(connected.response.ok, true);

    const denied = await router.handle(
      req("r_policy_update", "policy.update", {
        idempotencyKey: "idem_auth_member_forbidden_1",
        patch: {
          highRisk: "deny"
        },
        tenantId: "t_ext",
        workspaceId: "w_default"
      }),
      state
    );
    assert.equal(denied.response.ok, false);
    if (!denied.response.ok) {
      assert.equal(denied.response.error.code, "FORBIDDEN");
    }
  } finally {
    await jwksServer.close();
  }
});

test("AUTH-UT-001 JWKS key rotation accepts new kid after cache refresh", async (t) => {
  const keyPair1 = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPair2 = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwksPayload = {
    keys: [
      {
        ...keyPair1.publicKey.export({ format: "jwk" }),
        kid: "k1",
        use: "sig",
        alg: "RS256"
      }
    ]
  };
  const jwksServer = await startJwksServer(jwksPayload, t);
  if (!jwksServer) {
    return;
  }
  try {
    let nowMs = Date.now();
    const runtime = createGatewayAuthRuntime({
      config: {
        mode: "external",
        enterpriseRequireAuth: true,
        localJwtSecret: "s",
        localJwtExpiresSec: 3600,
        localIssuer: "openfoal-local",
        localAudience: "openfoal",
        defaultTenantCode: "default",
        defaultWorkspaceId: "w_default",
        defaultAdminUsername: "admin",
        defaultAdminPassword: "admin123!",
        jwksUrl: `${jwksServer.baseUrl}/.well-known/jwks.json`,
        jwtIssuer: "aipt5",
        jwtAudience: "openfoal-enterprise",
        externalRoleMap: {
          ADMIN: "tenant_admin",
          USER: "member"
        }
      },
      store: new InMemoryAuthStore(),
      now: () => new Date(nowMs)
    });
    const router = createGatewayRouter({
      authRuntime: runtime
    });

    const token1 = signRs256(
      {
        sub: "ext-rotate-1",
        tenantId: "t_rotate",
        workspaceIds: ["w_default"],
        roles: ["USER"],
        iss: "aipt5",
        aud: "openfoal-enterprise",
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(nowMs / 1000) + 3600
      },
      {
        kid: "k1",
        privateKeyPem: keyPair1.privateKey.export({
          type: "pkcs8",
          format: "pem"
        })
      }
    );
    const state1 = createConnectionState();
    const connected1 = await router.handle(
      req("r_connect_rotate_1", "connect", {
        auth: {
          token: token1
        }
      }),
      state1
    );
    assert.equal(connected1.response.ok, true);

    jwksPayload.keys = [
      {
        ...keyPair2.publicKey.export({ format: "jwk" }),
        kid: "k2",
        use: "sig",
        alg: "RS256"
      }
    ];
    nowMs += 6 * 60 * 1000;
    const token2 = signRs256(
      {
        sub: "ext-rotate-2",
        tenantId: "t_rotate",
        workspaceIds: ["w_default"],
        roles: ["USER"],
        iss: "aipt5",
        aud: "openfoal-enterprise",
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(nowMs / 1000) + 3600
      },
      {
        kid: "k2",
        privateKeyPem: keyPair2.privateKey.export({
          type: "pkcs8",
          format: "pem"
        })
      }
    );
    const state2 = createConnectionState();
    const connected2 = await router.handle(
      req("r_connect_rotate_2", "connect", {
        auth: {
          token: token2
        }
      }),
      state2
    );
    assert.equal(connected2.response.ok, true);
  } finally {
    await jwksServer.close();
  }
});

test("AUTH-UT-002 claim mapping maps tenantId/workspaces/roles into principal", async (t) => {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...keyPair.publicKey.export({ format: "jwk" }),
    kid: "k_claim",
    use: "sig",
    alg: "RS256"
  };
  const jwksServer = await startJwksServer({ keys: [jwk] }, t);
  if (!jwksServer) {
    return;
  }
  try {
    const nowMs = Date.now();
    const runtime = createGatewayAuthRuntime({
      config: {
        mode: "external",
        enterpriseRequireAuth: true,
        localJwtSecret: "s",
        localJwtExpiresSec: 3600,
        localIssuer: "openfoal-local",
        localAudience: "openfoal",
        defaultTenantCode: "default",
        defaultWorkspaceId: "w_default",
        defaultAdminUsername: "admin",
        defaultAdminPassword: "admin123!",
        jwksUrl: `${jwksServer.baseUrl}/.well-known/jwks.json`,
        jwtIssuer: "aipt5",
        jwtAudience: "openfoal-enterprise",
        externalRoleMap: {
          ADMIN: "tenant_admin",
          USER: "member"
        }
      },
      store: new InMemoryAuthStore()
    });
    const router = createGatewayRouter({
      authRuntime: runtime
    });
    const state = createConnectionState();
    const token = signRs256(
      {
        sub: "aipt5-user-claim-001",
        tenantId: "t_claim",
        workspaceIds: ["w_claim", "w_claim_2"],
        roles: ["ADMIN"],
        preferred_username: "claim-user",
        iss: "aipt5",
        aud: "openfoal-enterprise",
        iat: Math.floor(nowMs / 1000),
        exp: Math.floor(nowMs / 1000) + 3600
      },
      {
        kid: "k_claim",
        privateKeyPem: keyPair.privateKey.export({
          type: "pkcs8",
          format: "pem"
        })
      }
    );

    const connected = await router.handle(
      req("r_connect_claim_1", "connect", {
        auth: {
          token
        }
      }),
      state
    );
    assert.equal(connected.response.ok, true);
    assert.equal(state.principal?.tenantId, "t_claim");
    assert.equal(state.principal?.authSource, "external");
    assert.ok(state.principal?.workspaceIds.includes("w_claim"));
    assert.ok(state.principal?.workspaceIds.includes("w_claim_2"));
    assert.ok(state.principal?.roles.includes("tenant_admin"));
  } finally {
    await jwksServer.close();
  }
});

test("AUTH-UT-003 scope resolver blocks tenant/workspace mismatch", async () => {
  const nowMs = Date.now();
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "local",
      enterpriseRequireAuth: true,
      localJwtSecret: "scope_secret",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store: new InMemoryAuthStore()
  });
  const router = createGatewayRouter({
    authRuntime: runtime
  });
  const state = createConnectionState();
  const token = signHs256(
    {
      sub: "u_scope",
      tenantId: "t_scope",
      workspaceIds: ["w_scope"],
      roles: ["member"],
      iss: "openfoal-local",
      aud: "openfoal",
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 3600
    },
    "scope_secret"
  );
  const connected = await router.handle(
    req("r_connect_scope_1", "connect", {
      auth: {
        token
      }
    }),
    state
  );
  assert.equal(connected.response.ok, true);

  const tenantMismatch = await router.handle(
    req("r_scope_tenant_mismatch", "budget.get", {
      tenantId: "t_other",
      workspaceId: "w_scope"
    }),
    state
  );
  assert.equal(tenantMismatch.response.ok, false);
  if (!tenantMismatch.response.ok) {
    assert.equal(tenantMismatch.response.error.code, "TENANT_SCOPE_MISMATCH");
  }

  const workspaceMismatch = await router.handle(
    req("r_scope_workspace_mismatch", "budget.get", {
      tenantId: "t_scope",
      workspaceId: "w_other"
    }),
    state
  );
  assert.equal(workspaceMismatch.response.ok, false);
  if (!workspaceMismatch.response.ok) {
    assert.equal(workspaceMismatch.response.error.code, "WORKSPACE_SCOPE_MISMATCH");
  }
});

test("AUTH-UT-004 authorizer role matrix enforces member/workspace_admin/tenant_admin", async () => {
  const nowMs = Date.now();
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "local",
      enterpriseRequireAuth: true,
      localJwtSecret: "matrix_secret",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store: new InMemoryAuthStore()
  });
  const router = createGatewayRouter({
    authRuntime: runtime
  });

  const memberState = await connectLocalRole(router, {
    userId: "u_member_matrix",
    role: "member",
    tenantId: "t_matrix",
    workspaceIds: ["w_alpha"],
    secret: "matrix_secret",
    nowMs
  });
  const memberWrite = await router.handle(
    req("r_member_policy_update", "policy.update", {
      idempotencyKey: "idem_member_policy_update_1",
      tenantId: "t_matrix",
      workspaceId: "w_alpha",
      patch: {
        highRisk: "allow"
      }
    }),
    memberState
  );
  assert.equal(memberWrite.response.ok, false);
  if (!memberWrite.response.ok) {
    assert.equal(memberWrite.response.error.code, "FORBIDDEN");
  }
  const memberRead = await router.handle(
    req("r_member_budget_get", "budget.get", {
      tenantId: "t_matrix",
      workspaceId: "w_alpha"
    }),
    memberState
  );
  assert.equal(memberRead.response.ok, true);
  const memberUsersList = await router.handle(
    req("r_member_users_list", "users.list", {
      tenantId: "t_matrix"
    }),
    memberState
  );
  assert.equal(memberUsersList.response.ok, false);
  if (!memberUsersList.response.ok) {
    assert.equal(memberUsersList.response.error.code, "FORBIDDEN");
  }
  const memberSkillSyncUpsert = await router.handle(
    req("r_member_skill_sync_upsert", "skills.syncConfig.upsert", {
      idempotencyKey: "idem_member_skill_sync_upsert_1",
      scope: "user",
      config: {
        autoSyncEnabled: true,
        syncTime: "03:00"
      }
    }),
    memberState
  );
  assert.equal(memberSkillSyncUpsert.response.ok, true);
  const bundleSeedState = await connectLocalRole(router, {
    userId: "u_bundle_seed",
    role: "tenant_admin",
    tenantId: "t_matrix",
    workspaceIds: ["w_alpha"],
    secret: "matrix_secret",
    nowMs
  });
  const bundleSeed = await router.handle(
    req("r_seed_bundle_for_member_install", "skills.bundle.import", {
      idempotencyKey: "idem_seed_bundle_for_member_install_1",
      bundle: {
        bundleId: "bundle_auth_seed_1",
        name: "bundle-auth-seed",
        items: [
          {
            skillId: "demo.skill",
            sourceType: "bundle",
            artifactVersion: "v1",
            entrySkillPath: "SKILL.md",
            tags: ["seed"],
            files: [
              {
                path: "SKILL.md",
                content: "# demo.skill\n"
              }
            ]
          }
        ]
      }
    }),
    bundleSeedState
  );
  assert.equal(bundleSeed.response.ok, true);
  const memberSkillInstallAllowed = await router.handle(
    req("r_member_skill_install", "skills.install", {
      idempotencyKey: "idem_member_skill_install_1",
      scope: "user",
      skillId: "demo.skill"
    }),
    memberState
  );
  assert.equal(memberSkillInstallAllowed.response.ok, true);
  const memberBundleListDenied = await router.handle(
    req("r_member_bundle_list_denied", "skills.bundle.list", {
      tenantId: "t_matrix"
    }),
    memberState
  );
  assert.equal(memberBundleListDenied.response.ok, false);
  if (!memberBundleListDenied.response.ok) {
    assert.equal(memberBundleListDenied.response.error.code, "FORBIDDEN");
  }

  const workspaceAdminState = await connectLocalRole(router, {
    userId: "u_workspace_admin_matrix",
    role: "workspace_admin",
    tenantId: "t_matrix",
    workspaceIds: ["w_alpha"],
    secret: "matrix_secret",
    nowMs
  });
  const workspaceAdminWriteAllowed = await router.handle(
    req("r_workspace_admin_policy_update_ok", "policy.update", {
      idempotencyKey: "idem_workspace_admin_policy_update_ok_1",
      tenantId: "t_matrix",
      workspaceId: "w_alpha",
      patch: {
        highRisk: "allow"
      }
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminWriteAllowed.response.ok, true);

  const workspaceAdminCrossWorkspace = await router.handle(
    req("r_workspace_admin_policy_update_cross", "policy.update", {
      idempotencyKey: "idem_workspace_admin_policy_update_cross_1",
      tenantId: "t_matrix",
      workspaceId: "w_beta",
      patch: {
        highRisk: "deny"
      }
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminCrossWorkspace.response.ok, false);
  if (!workspaceAdminCrossWorkspace.response.ok) {
    assert.equal(workspaceAdminCrossWorkspace.response.error.code, "WORKSPACE_SCOPE_MISMATCH");
  }
  const workspaceAdminUsersList = await router.handle(
    req("r_workspace_admin_users_list", "users.list", {
      tenantId: "t_matrix"
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminUsersList.response.ok, true);
  const workspaceAdminBundleListDenied = await router.handle(
    req("r_workspace_admin_bundle_list_denied", "skills.bundle.list", {
      tenantId: "t_matrix"
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminBundleListDenied.response.ok, false);
  if (!workspaceAdminBundleListDenied.response.ok) {
    assert.equal(workspaceAdminBundleListDenied.response.error.code, "FORBIDDEN");
  }
  const workspaceAdminUsersCreateDenied = await router.handle(
    req("r_workspace_admin_users_create_denied", "users.create", {
      idempotencyKey: "idem_workspace_admin_users_create_1",
      tenantId: "t_matrix",
      username: "wa_create_denied",
      password: "x",
      memberships: [
        {
          workspaceId: "w_alpha",
          role: "member"
        }
      ]
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminUsersCreateDenied.response.ok, false);
  if (!workspaceAdminUsersCreateDenied.response.ok) {
    assert.equal(workspaceAdminUsersCreateDenied.response.error.code, "FORBIDDEN");
  }
  const workspaceAdminMembershipOk = await router.handle(
    req("r_workspace_admin_membership_ok", "users.updateMemberships", {
      idempotencyKey: "idem_workspace_admin_membership_ok_1",
      tenantId: "t_matrix",
      userId: "u_workspace_admin_matrix",
      memberships: [
        {
          workspaceId: "w_alpha",
          role: "workspace_admin"
        }
      ]
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminMembershipOk.response.ok, true);
  const workspaceAdminMembershipDenied = await router.handle(
    req("r_workspace_admin_membership_denied", "users.updateMemberships", {
      idempotencyKey: "idem_workspace_admin_membership_denied_1",
      tenantId: "t_matrix",
      userId: "u_workspace_admin_matrix",
      memberships: [
        {
          workspaceId: "w_beta",
          role: "workspace_admin"
        }
      ]
    }),
    workspaceAdminState
  );
  assert.equal(workspaceAdminMembershipDenied.response.ok, false);
  if (!workspaceAdminMembershipDenied.response.ok) {
    assert.equal(workspaceAdminMembershipDenied.response.error.code, "WORKSPACE_SCOPE_MISMATCH");
  }

  const tenantAdminState = await connectLocalRole(router, {
    userId: "u_tenant_admin_matrix",
    role: "tenant_admin",
    tenantId: "t_matrix",
    workspaceIds: ["w_alpha"],
    secret: "matrix_secret",
    nowMs
  });
  const tenantAdminWriteCrossWorkspace = await router.handle(
    req("r_tenant_admin_policy_update_cross", "policy.update", {
      idempotencyKey: "idem_tenant_admin_policy_update_cross_1",
      tenantId: "t_matrix",
      workspaceId: "w_any",
      patch: {
        highRisk: "allow"
      }
    }),
    tenantAdminState
  );
  assert.equal(tenantAdminWriteCrossWorkspace.response.ok, true);
  const tenantAdminSecretWrite = await router.handle(
    req("r_tenant_admin_secret_write", "secrets.upsertModelKey", {
      idempotencyKey: "idem_tenant_admin_secret_write_1",
      tenantId: "t_matrix",
      workspaceId: "w_any",
      provider: "openai",
      apiKey: "sk-tenant-admin-1234"
    }),
    tenantAdminState
  );
  assert.equal(tenantAdminSecretWrite.response.ok, true);
});

test("AUTH-IT-001 disabled local user cannot login or call me", async () => {
  const store = new InMemoryAuthStore();
  const runtime = createGatewayAuthRuntime({
    config: {
      mode: "local",
      enterpriseRequireAuth: true,
      localJwtSecret: "disabled_secret",
      localJwtExpiresSec: 3600,
      localIssuer: "openfoal-local",
      localAudience: "openfoal",
      defaultTenantCode: "default",
      defaultWorkspaceId: "w_default",
      defaultAdminUsername: "admin",
      defaultAdminPassword: "admin123!",
      externalRoleMap: {
        ADMIN: "tenant_admin",
        USER: "member"
      }
    },
    store
  });

  const login = await runtime.login({
    tenant: "default",
    username: "admin",
    password: "admin123!"
  });
  const token = String(login.access_token ?? "");
  assert.equal(token.length > 0, true);

  const tenant = await store.findTenantByCode("default");
  assert.ok(tenant);
  const admin = await store.findLocalUser(tenant.id, "admin");
  assert.ok(admin);
  await store.updateUserStatus({
    tenantId: tenant.id,
    userId: admin.id,
    status: "disabled"
  });

  await assert.rejects(
    () =>
      runtime.login({
        tenant: "default",
        username: "admin",
        password: "admin123!"
      }),
    (error) => error?.code === "UNAUTHORIZED"
  );

  await assert.rejects(
    () => runtime.me(`Bearer ${token}`),
    (error) => String(error?.message ?? "").includes("账号已禁用")
  );
});

function signHs256(payload, secret) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
}

async function connectLocalRole(router, input) {
  const state = createConnectionState();
  const token = signHs256(
    {
      sub: input.userId,
      tenantId: input.tenantId,
      workspaceIds: input.workspaceIds,
      roles: [input.role],
      iss: "openfoal-local",
      aud: "openfoal",
      iat: Math.floor(input.nowMs / 1000),
      exp: Math.floor(input.nowMs / 1000) + 3600
    },
    input.secret
  );
  const connected = await router.handle(
    req(`r_connect_${input.userId}`, "connect", {
      auth: {
        token
      }
    }),
    state
  );
  assert.equal(connected.response.ok, true);
  return state;
}

function signRs256(payload, input) {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: input.kid
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(input.privateKeyPem);
  return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
}

function base64UrlEncode(text) {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeBuffer(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function startJwksServer(payload, t) {
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (req.url !== "/.well-known/jwks.json") {
      res.statusCode = 404;
      res.end("not_found");
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EPERM") {
      t.skip("sandbox does not allow binding localhost");
      return null;
    }
    throw error;
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close
  };
}
