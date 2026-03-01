import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'
import { useAuthStore } from '@/stores/auth-store'

interface AdminRouteGuardProps {
  children: ReactNode
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const session = useAuthStore((state) => state.session)

  if (!session) {
    return <Navigate to={routePaths.login} replace />
  }

  if (session.role !== 'admin') {
    return <Navigate to={routePaths.userPrototype} replace />
  }

  return <>{children}</>
}
