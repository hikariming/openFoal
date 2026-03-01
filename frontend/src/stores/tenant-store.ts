import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Tenant {
  id: string
  name: string
}

interface TenantState {
  tenants: Tenant[]
  currentTenantId: string
  setTenants: (tenants: Tenant[]) => void
  setCurrentTenant: (tenantId: string) => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set, get) => ({
      tenants: [],
      currentTenantId: '',
      setTenants: (tenants) => {
        set((state) => {
          const hasCurrent = tenants.some((tenant) => tenant.id === state.currentTenantId)
          return {
            tenants,
            currentTenantId: hasCurrent ? state.currentTenantId : (tenants[0]?.id ?? ''),
          }
        })
      },
      setCurrentTenant: (tenantId) => {
        if (!tenantId) {
          return
        }

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
