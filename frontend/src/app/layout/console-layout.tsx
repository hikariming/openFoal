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
import { routePaths } from '@/app/router/route-paths'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantStore } from '@/stores/tenant-store'
import { useUiStore } from '@/stores/ui-store'

const navItems = [
  { itemKey: routePaths.dashboard, text: 'Dashboard', icon: <IconHomeStroked size="large" /> },
  { itemKey: routePaths.members, text: '成员管理', icon: <IconUserGroup size="large" /> },
  { itemKey: routePaths.rbac, text: 'RBAC 权限', icon: <IconSafeStroked size="large" /> },
  { itemKey: routePaths.audit, text: '审计日志', icon: <IconHistory size="large" /> },
  { itemKey: routePaths.sso, text: 'SSO 配置', icon: <IconKeyStroked size="large" /> },
  { itemKey: routePaths.mcp, text: '企业 MCP', icon: <IconServerStroked size="large" /> },
  { itemKey: routePaths.skills, text: '企业 Skill', icon: <IconPuzzle size="large" /> },
]

export function ConsoleLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuthStore((state) => state.logout)
  const session = useAuthStore((state) => state.session)
  const tenants = useTenantStore((state) => state.tenants)
  const currentTenantId = useTenantStore((state) => state.currentTenantId)
  const siderCollapsed = useUiStore((state) => state.siderCollapsed)
  const toggleSider = useUiStore((state) => state.toggleSider)

  const currentTenant = tenants.find((tenant) => tenant.id === currentTenantId) ?? tenants[0]
  const userInitial = (session?.name?.slice(0, 1) || 'U').toUpperCase()

  const onLogout = () => {
    logout()
    navigate(routePaths.login)
  }

  const onAskLogout = () => {
    Modal.confirm({
      title: '确认退出当前账号？',
      content: '这会清理本地登录状态。',
      okText: '退出',
      cancelText: '取消',
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
            {!siderCollapsed ? <span className="app-brand-text">OpenFoal Enterprise</span> : null}
          </div>

          {!siderCollapsed ? (
            <div className="app-sider-tenant-chip">
              <Typography.Text type="tertiary" size="small">
                当前租户
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
                    {session?.name ?? '未登录用户'}
                  </Typography.Text>
                  <Typography.Text type="tertiary" className="app-profile-email">
                    {session?.email ?? '-'}
                  </Typography.Text>
                </div>
              ) : null}
            </div>

            <Space spacing={8} className="app-sider-actions">
              <Tooltip content={siderCollapsed ? '展开侧栏' : '收起侧栏'}>
                <Button
                  theme="light"
                  type="tertiary"
                  icon={<IconSidebar />}
                  className="app-sider-action-btn"
                  onClick={toggleSider}
                />
              </Tooltip>
              <Tooltip content="退出登录">
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
            <Typography.Text strong>{session?.name ?? '未登录用户'}</Typography.Text>
            <Typography.Text type="tertiary">{session?.email ?? '-'}</Typography.Text>
          </Space>
          <Space>
            <Typography.Text type="tertiary">当前租户</Typography.Text>
            <Tag color="light-blue">{currentTenant?.name ?? '-'}</Tag>
          </Space>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
