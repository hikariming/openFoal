import {
  Avatar,
  Button,
  Layout,
  Modal,
  Nav,
  Space,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui'
import {
  IconDesktop,
  IconExit,
  IconHistory,
  IconHomeStroked,
  IconKeyStroked,
  IconPuzzle,
  IconSafeStroked,
  IconServerStroked,
  IconSidebar,
  IconUserGroup,
} from '@douyinfe/semi-icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { routePaths } from '@/app/router/route-paths'
import { LanguageSwitch } from '@/components/shared/language-switch'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantStore } from '@/stores/tenant-store'
import { useUiStore } from '@/stores/ui-store'

export function ConsoleLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((state) => state.logout)
  const session = useAuthStore((state) => state.session)
  const tenants = useTenantStore((state) => state.tenants)
  const currentTenantId = useTenantStore((state) => state.currentTenantId)
  const siderCollapsed = useUiStore((state) => state.siderCollapsed)
  const toggleSider = useUiStore((state) => state.toggleSider)

  const navItems = [
    { itemKey: routePaths.dashboard, text: t('layout.nav.dashboard'), icon: <IconHomeStroked size="large" /> },
    { itemKey: routePaths.members, text: t('layout.nav.members'), icon: <IconUserGroup size="large" /> },
    { itemKey: routePaths.rbac, text: t('layout.nav.rbac'), icon: <IconSafeStroked size="large" /> },
    { itemKey: routePaths.audit, text: t('layout.nav.audit'), icon: <IconHistory size="large" /> },
    { itemKey: routePaths.sso, text: t('layout.nav.sso'), icon: <IconKeyStroked size="large" /> },
    { itemKey: routePaths.mcp, text: t('layout.nav.mcp'), icon: <IconServerStroked size="large" /> },
    { itemKey: routePaths.sandbox, text: t('layout.nav.sandbox'), icon: <IconDesktop size="large" /> },
    { itemKey: routePaths.skills, text: t('layout.nav.skills'), icon: <IconPuzzle size="large" /> },
  ]

  const currentTenant = tenants.find((tenant) => tenant.id === currentTenantId) ?? tenants[0]
  const userInitial = (session?.name?.slice(0, 1) || 'U').toUpperCase()

  const onLogout = () => {
    logout()
    navigate(routePaths.login)
  }

  const onAskLogout = () => {
    Modal.confirm({
      title: t('layout.logoutConfirmTitle'),
      content: t('layout.logoutConfirmContent'),
      okText: t('layout.logoutConfirmOk'),
      cancelText: t('layout.logoutConfirmCancel'),
      onOk: onLogout,
    })
  }

  return (
    <Layout className="app-shell">
      <Layout.Sider
        className={`app-sider ${siderCollapsed ? 'is-collapsed' : ''}`}
        style={{
          minHeight: '100vh',
          width: siderCollapsed ? 80 : 248,
          overflow: 'hidden',
          transition: 'width 0.24s ease',
        }}
      >
        <div className="app-sider-inner">
          <div className="app-brand">
            <div className="app-brand-mark">OF</div>
            {!siderCollapsed ? <span className="app-brand-text">{t('layout.brand')}</span> : null}
          </div>

          {!siderCollapsed ? (
            <div className="app-sider-tenant-chip">
              <Typography.Text type="tertiary" size="small">
                {t('common.currentTenant')}
              </Typography.Text>
              <Tag color="light-blue">{currentTenant?.name ?? '-'}</Tag>
            </div>
          ) : null}

          <Nav
            className="app-nav"
            mode="vertical"
            collapsed={siderCollapsed}
            selectedKeys={[location.pathname]}
            items={navItems}
            onSelect={(data) => {
              if (typeof data.itemKey === 'string') {
                navigate(data.itemKey)
              }
            }}
          />

          <div className="app-sider-footer">
            <div className="app-profile-card">
              <Avatar size="small" color="blue">
                {userInitial}
              </Avatar>
              {!siderCollapsed ? (
                <div className="app-profile-meta">
                  <Typography.Text strong className="app-profile-name">
                    {session?.name ?? t('common.unknownUser')}
                  </Typography.Text>
                  <Typography.Text type="tertiary" className="app-profile-email">
                    {session?.email ?? '-'}
                  </Typography.Text>
                </div>
              ) : null}
            </div>

            <Space spacing={8} className="app-sider-actions">
              <Tooltip content={siderCollapsed ? t('layout.expandSidebar') : t('layout.collapseSidebar')}>
                <Button
                  theme="light"
                  type="tertiary"
                  icon={<IconSidebar />}
                  className="app-sider-action-btn"
                  onClick={toggleSider}
                />
              </Tooltip>
              <Tooltip content={t('layout.logoutTooltip')}>
                <Button
                  theme="light"
                  type="danger"
                  icon={<IconExit />}
                  className="app-sider-action-btn"
                  onClick={onAskLogout}
                />
              </Tooltip>
            </Space>
          </div>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="app-header">
          <Space>
            <Typography.Text strong>{session?.name ?? t('common.unknownUser')}</Typography.Text>
            <Typography.Text type="tertiary">{session?.email ?? '-'}</Typography.Text>
          </Space>
          <Space>
            <Typography.Text type="tertiary">{t('common.currentTenant')}</Typography.Text>
            <Tag color="light-blue">{currentTenant?.name ?? '-'}</Tag>
            <LanguageSwitch />
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
