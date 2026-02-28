import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { routePaths } from '@/app/router/route-paths'
import { useAuthStore } from '@/stores/auth-store'

interface AuthGuardProps {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const location = useLocation()

  if (!isAuthenticated) {
    return (
      <Navigate
        to={routePaths.login}
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }

  return <>{children}</>
}
