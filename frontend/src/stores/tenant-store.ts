import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Tenant {
  id: string
  name: string
  region: string
}

interface TenantState {
  tenants: Tenant[]
  currentTenantId: string
  setCurrentTenant: (tenantId: string) => void
}

const defaultTenants: Tenant[] = [
  { id: 'tenant_hq', name: 'OpenFoal HQ', region: 'us-east-1' },
  { id: 'tenant_cn', name: 'OpenFoal China', region: 'ap-east-1' },
]

export const useTenantStore = create<TenantState>()(
  persist(
    (set, get) => ({
      tenants: defaultTenants,
      currentTenantId: defaultTenants[0].id,
      setCurrentTenant: (tenantId) => {
        if (!get().tenants.some((tenant) => tenant.id === tenantId)) {
          return
        }
        set({ currentTenantId: tenantId })
      },
    }),
    {
      name: 'enterprise-tenant-store',
      partialize: (state) => ({ currentTenantId: state.currentTenantId }),
    },
  ),
)
