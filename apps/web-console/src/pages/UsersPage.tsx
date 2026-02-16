import { Banner, Button, Form, Input, Select, Space, Tag, Typography } from "@douyinfe/semi-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { resolveConsolePermissions } from "../app/permissions";
import { AdminTableCard } from "../components/admin/AdminTableCard";
import { CrudSheet } from "../components/admin/CrudSheet";
import { RowActions } from "../components/admin/RowActions";
import { getGatewayClient, type GatewayTenantUser, type UserRole, type UserStatus } from "../lib/gateway-client";
import { useAuthStore } from "../stores/auth-store";
import { useScopeStore } from "../stores/scope-store";
import { formatDate, toErrorMessage } from "./shared";
import { useClientTableState } from "./hooks/useClientTableState";

type UserRow = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  status: UserStatus;
  memberships: string;
  roles: UserRole[];
  lastLoginAt?: string;
  updatedAt?: string;
};

type CreateUserForm = {
  username: string;
  password: string;
  displayName: string;
  email: string;
  role: UserRole;
};

type MembershipForm = {
  userId: string;
  role: UserRole;
};

type ResetPasswordForm = {
  userId: string;
  newPassword: string;
};

export function UsersPage(): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => getGatewayClient(), []);
  const principal = useAuthStore((state) => state.principal);
  const permissions = resolveConsolePermissions(principal);
  const tenantId = useScopeStore((state) => state.tenantId);
  const workspaceId = useScopeStore((state) => state.workspaceId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [users, setUsers] = useState<GatewayTenantUser[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | UserStatus>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [createVisible, setCreateVisible] = useState(false);
  const [membershipVisible, setMembershipVisible] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);

  const load = useCallback(async () => {
    if (!permissions.canReadUsers) {
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const list = await client.listUsers({ tenantId, workspaceId });
      setUsers(list);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canReadUsers, tenantId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<UserRow[]>(
    () =>
      users.map((item) => ({
        userId: item.user.id,
        username: item.user.username,
        displayName: item.user.displayName ?? "",
        email: item.user.email ?? "",
        status: item.user.status,
        memberships: item.memberships.map((membership) => `${membership.workspaceId}:${membership.role}`).join(", "),
        roles: item.memberships.map((membership) => membership.role),
        lastLoginAt: item.user.lastLoginAt,
        updatedAt: item.tenant.updatedAt
      })),
    [users]
  );

  const roleFilterRows = useMemo(() => {
    return rows.filter((row) => (statusFilter === "all" ? true : row.status === statusFilter)).filter((row) => (roleFilter === "all" ? true : row.roles.includes(roleFilter)));
  }, [roleFilter, rows, statusFilter]);

  const table = useClientTableState<UserRow, "username" | "updatedAt">({
    items: roleFilterRows,
    initialPageSize: 20,
    initialSortKey: "updatedAt",
    initialSortOrder: "desc",
    searchableText: (item) => `${item.username} ${item.userId} ${item.displayName} ${item.email} ${item.memberships}`,
    comparators: {
      username: (left, right) => left.username.localeCompare(right.username),
      updatedAt: (left, right) => String(left.updatedAt ?? "").localeCompare(String(right.updatedAt ?? ""))
    }
  });

  const createUser = useCallback(
    async (values: CreateUserForm) => {
      if (!permissions.canCreateUsers) {
        return;
      }
      const username = values.username.trim();
      const password = values.password;
      if (!username || !password) {
        setError("username/password required");
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.createUser({
          tenantId,
          username,
          password,
          displayName: values.displayName.trim() || undefined,
          email: values.email.trim() || undefined,
          memberships: [{ workspaceId, role: values.role }]
        });
        setCreateVisible(false);
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setSheetLoading(false);
      }
    },
    [client, load, permissions.canCreateUsers, tenantId, workspaceId]
  );

  const updateMembership = useCallback(
    async (values: MembershipForm) => {
      if (!permissions.canUpdateMemberships) {
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.updateUserMemberships({
          tenantId,
          userId: values.userId,
          memberships: [{ workspaceId, role: values.role }]
        });
        setMembershipVisible(false);
        setEditingUser(null);
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setSheetLoading(false);
      }
    },
    [client, load, permissions.canUpdateMemberships, tenantId, workspaceId]
  );

  const resetPassword = useCallback(
    async (values: ResetPasswordForm) => {
      if (!permissions.canResetUserPassword) {
        return;
      }
      if (!values.newPassword.trim()) {
        setError("newPassword required");
        return;
      }
      setSheetLoading(true);
      setError(undefined);
      try {
        await client.resetUserPassword({
          tenantId,
          userId: values.userId,
          newPassword: values.newPassword
        });
        setResetVisible(false);
        setEditingUser(null);
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setSheetLoading(false);
      }
    },
    [client, load, permissions.canResetUserPassword, tenantId]
  );

  const toggleStatus = useCallback(
    async (row: UserRow) => {
      if (!permissions.canUpdateUserStatus) {
        return;
      }
      const next: UserStatus = row.status === "active" ? "disabled" : "active";
      if (!window.confirm(`${row.username} => ${next}?`)) {
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        await client.updateUserStatus({
          tenantId,
          userId: row.userId,
          status: next
        });
        await load();
      } catch (actionError) {
        setError(toErrorMessage(actionError));
      } finally {
        setLoading(false);
      }
    },
    [client, load, permissions.canUpdateUserStatus, tenantId]
  );

  const columns = useMemo<Array<Record<string, unknown>>>(
    () => [
      { title: t("users.username"), dataIndex: "username", width: 180 },
      { title: t("users.displayName"), dataIndex: "displayName", width: 160, render: (text: string) => text || "-" },
      { title: t("users.email"), dataIndex: "email", width: 220, render: (text: string) => text || "-" },
      {
        title: t("users.status"),
        dataIndex: "status",
        width: 120,
        render: (text: UserStatus) => <Tag color={text === "active" ? "green" : "red"}>{text}</Tag>
      },
      {
        title: t("users.memberships"),
        dataIndex: "memberships",
        render: (text: string) => (
          <Typography.Text size="small" type="tertiary">
            {text || "-"}
          </Typography.Text>
        )
      },
      {
        title: "lastLogin",
        dataIndex: "lastLoginAt",
        width: 180,
        render: (text: string | undefined) => (
          <Typography.Text size="small" type="tertiary">
            {formatDate(text)}
          </Typography.Text>
        )
      },
      {
        title: "updatedAt",
        dataIndex: "updatedAt",
        width: 180,
        render: (text: string | undefined) => (
          <Typography.Text size="small" type="tertiary">
            {formatDate(text)}
          </Typography.Text>
        )
      },
      {
        title: t("common.actions"),
        dataIndex: "actions",
        width: 240,
        render: (_: unknown, row: UserRow) => (
          <RowActions
            actions={[
              {
                key: "membership",
                text: t("users.memberships"),
                onClick: () => {
                  setEditingUser(row);
                  setMembershipVisible(true);
                },
                disabled: !permissions.canUpdateMemberships
              },
              {
                key: "status",
                text: row.status === "active" ? t("common.disabled") : t("common.enabled"),
                onClick: () => void toggleStatus(row),
                disabled: !permissions.canUpdateUserStatus
              },
              {
                key: "reset",
                text: t("users.resetPassword"),
                onClick: () => {
                  setEditingUser(row);
                  setResetVisible(true);
                },
                disabled: !permissions.canResetUserPassword
              }
            ]}
          />
        )
      }
    ],
    [permissions.canResetUserPassword, permissions.canUpdateMemberships, permissions.canUpdateUserStatus, t, toggleStatus]
  );

  if (!permissions.canReadUsers) {
    return <Banner type="warning" closeIcon={null} description={t("common.forbidden")} />;
  }

  return (
    <Space vertical align="start" style={{ width: "100%" }}>
      <PageHeader
        title={t("users.title")}
        actions={
          <Button theme="light" loading={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
      <AdminTableCard
        title={t("users.title")}
        loading={loading}
        columns={columns}
        dataSource={table.pageItems}
        rowKey="userId"
        emptyText={t("common.noData")}
        page={table.query.page}
        pageSize={table.query.pageSize}
        total={table.total}
        totalPages={table.totalPages}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        toolbar={
          <Space wrap>
            <Input
              style={{ width: 220 }}
              placeholder={`${t("common.search")} username/email/userId`}
              value={table.query.search}
              onChange={(value) => table.setSearch(value)}
            />
            <Select
              style={{ width: 140 }}
              value={statusFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "active", value: "active" },
                { label: "disabled", value: "disabled" }
              ]}
              onChange={(value) => {
                setStatusFilter((value as "all" | UserStatus) ?? "all");
                table.resetPage();
              }}
            />
            <Select
              style={{ width: 180 }}
              value={roleFilter}
              optionList={[
                { label: "all", value: "all" },
                { label: "tenant_admin", value: "tenant_admin" },
                { label: "workspace_admin", value: "workspace_admin" },
                { label: "member", value: "member" }
              ]}
              onChange={(value) => {
                setRoleFilter((value as "all" | UserRole) ?? "all");
                table.resetPage();
              }}
            />
            <Select
              style={{ width: 160 }}
              value={table.query.sortKey ?? "updatedAt"}
              optionList={[
                { label: "updatedAt", value: "updatedAt" },
                { label: "username", value: "username" }
              ]}
              onChange={(value) => table.setSort((value as "username" | "updatedAt") ?? "updatedAt", table.query.sortOrder)}
            />
            <Select
              style={{ width: 120 }}
              value={table.query.sortOrder}
              optionList={[
                { label: "desc", value: "desc" },
                { label: "asc", value: "asc" }
              ]}
              onChange={(value) => table.setSort(table.query.sortKey, (value as "asc" | "desc") ?? "desc")}
            />
            <Button theme="solid" disabled={!permissions.canCreateUsers} onClick={() => setCreateVisible(true)}>
              {t("common.createNew")}
            </Button>
          </Space>
        }
      />

      <CrudSheet<CreateUserForm>
        visible={createVisible}
        title={t("users.createUser")}
        mode="create"
        loading={sheetLoading}
        initValues={{
          username: "",
          password: "",
          displayName: "",
          email: "",
          role: "member"
        }}
        onCancel={() => setCreateVisible(false)}
        onSubmit={createUser}
      >
        <Form.Input field="username" label={t("users.username")} />
        <Form.Input field="password" mode="password" label={t("users.password")} />
        <Form.Input field="displayName" label={t("users.displayName")} />
        <Form.Input field="email" label={t("users.email")} />
        <Form.Select
          field="role"
          label={t("users.role")}
          optionList={[
            { label: "member", value: "member" },
            { label: "workspace_admin", value: "workspace_admin" },
            { label: "tenant_admin", value: "tenant_admin" }
          ]}
        />
      </CrudSheet>

      <CrudSheet<MembershipForm>
        visible={membershipVisible}
        title={t("users.memberships")}
        mode="edit"
        loading={sheetLoading}
        initValues={{
          userId: editingUser?.userId ?? "",
          role: editingUser?.roles[0] ?? "member"
        }}
        onCancel={() => {
          setMembershipVisible(false);
          setEditingUser(null);
        }}
        onSubmit={updateMembership}
      >
        <Form.Input field="userId" label={t("common.userId")} disabled />
        <Form.Select
          field="role"
          label={t("users.role")}
          optionList={[
            { label: "member", value: "member" },
            { label: "workspace_admin", value: "workspace_admin" },
            { label: "tenant_admin", value: "tenant_admin" }
          ]}
        />
      </CrudSheet>

      <CrudSheet<ResetPasswordForm>
        visible={resetVisible}
        title={t("users.resetPassword")}
        mode="edit"
        loading={sheetLoading}
        initValues={{
          userId: editingUser?.userId ?? "",
          newPassword: ""
        }}
        onCancel={() => {
          setResetVisible(false);
          setEditingUser(null);
        }}
        onSubmit={resetPassword}
      >
        <Form.Input field="userId" label={t("common.userId")} disabled />
        <Form.Input field="newPassword" mode="password" label={t("users.newPassword")} />
      </CrudSheet>
    </Space>
  );
}

