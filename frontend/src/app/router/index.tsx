import { lazy, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Empty, Spin } from '@douyinfe/semi-ui'
import { useTranslation } from 'react-i18next'
import { ConsoleLayout } from '@/app/layout/console-layout'
import { AuthGuard } from '@/components/auth/auth-guard'
import { routePaths } from '@/app/router/route-paths'

const DashboardPage = lazy(() => import('@/pages/dashboard/page'))
const MembersPage = lazy(() => import('@/pages/members/page'))
const RbacPage = lazy(() => import('@/pages/rbac/page'))
const AuditPage = lazy(() => import('@/pages/audit/page'))
const SsoPage = lazy(() => import('@/pages/sso/page'))
const McpPage = lazy(() => import('@/pages/mcp/page'))
const SkillsPage = lazy(() => import('@/pages/skills/page'))
const LoginPage = lazy(() => import('@/pages/login/page'))
const UserPrototypePage = lazy(() => import('@/pages/user-prototype/page'))
const NotFoundPage = lazy(() => import('@/pages/not-found/page'))

function RouteFallback() {
  const { t } = useTranslation()
  return <Spin size="large" tip={t('router.loading')} />
}

function RouteNotFound() {
  const { t } = useTranslation()

  return (
    <Empty
      title={t('router.pageNotFoundTitle')}
      description={t('router.pageNotFoundDescription')}
      imageStyle={{ width: 180, height: 180 }}
    />
  )
}

function withSuspense(node: ReactElement) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
}

export const router = createBrowserRouter([
  {
    path: routePaths.login,
    element: withSuspense(<LoginPage />),
  },
  {
    path: routePaths.userPrototype,
    element: withSuspense(<UserPrototypePage />),
  },
  {
    path: '/',
    element: (
      <AuthGuard>
        <ConsoleLayout />
      </AuthGuard>
    ),
    children: [
      {
        index: true,
        element: <Navigate to={routePaths.dashboard} replace />,
      },
      {
        path: routePaths.dashboard,
        element: withSuspense(<DashboardPage />),
      },
      {
        path: routePaths.members,
        element: withSuspense(<MembersPage />),
      },
      {
        path: routePaths.rbac,
        element: withSuspense(<RbacPage />),
      },
      {
        path: routePaths.audit,
        element: withSuspense(<AuditPage />),
      },
      {
        path: routePaths.sso,
        element: withSuspense(<SsoPage />),
      },
      {
        path: routePaths.mcp,
        element: withSuspense(<McpPage />),
      },
      {
        path: routePaths.skills,
        element: withSuspense(<SkillsPage />),
      },
      {
        path: '*',
        element: <RouteNotFound />,
      },
    ],
  },
  {
    path: '*',
    element: withSuspense(<NotFoundPage />),
  },
])
