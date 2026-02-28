import { Banner, Button, Card, Input, Space } from "@douyinfe/semi-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

export function LoginPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loading = useAuthStore((state) => state.loading);
  const authenticated = useAuthStore((state) => state.authenticated);
  const error = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);
  const clearError = useAuthStore((state) => state.clearError);

  const [form, setForm] = useState({
    tenant: "default",
    username: "admin",
    password: "admin123!"
  });

  useEffect(() => {
    if (authenticated) {
      navigate("/", { replace: true });
    }
  }, [authenticated, navigate]);

  return (
    <div className="login-page">
      <Card title={t("auth.title")} style={{ width: 420 }}>
        <Space vertical align="start" style={{ width: "100%" }}>
          {error ? <Banner type="danger" closeIcon={null} description={error} /> : null}
          <Input
            value={form.tenant}
            placeholder={t("auth.tenant")}
            onChange={(value) => {
              clearError();
              setForm((prev) => ({ ...prev, tenant: value }));
            }}
          />
          <Input
            value={form.username}
            placeholder={t("auth.username")}
            onChange={(value) => {
              clearError();
              setForm((prev) => ({ ...prev, username: value }));
            }}
          />
          <Input
            value={form.password}
            type="password"
            placeholder={t("auth.password")}
            onChange={(value) => {
              clearError();
              setForm((prev) => ({ ...prev, password: value }));
            }}
          />
          <Button
            theme="solid"
            loading={loading}
            onClick={() =>
              void login({
                tenant: form.tenant,
                username: form.username,
                password: form.password
              })
            }
          >
            {t("common.login")}
          </Button>
        </Space>
      </Card>
    </div>
  );
}
