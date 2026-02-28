import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  siderCollapsed: boolean
  toggleSider: () => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      siderCollapsed: false,
      toggleSider: () => {
        set({ siderCollapsed: !get().siderCollapsed })
      },
    }),
    {
      name: 'enterprise-ui-store',
      partialize: (state) => ({ siderCollapsed: state.siderCollapsed }),
    },
  ),
)
