import { create } from "zustand";
import type { GatewayPrincipal } from "../lib/gateway-client";

type ScopeState = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  scopeKey: string;
  setTenantId: (tenantId: string) => void;
  setWorkspaceId: (workspaceId: string) => void;
  setUserId: (userId: string) => void;
  setScopeKey: (scopeKey: string) => void;
  setFromPrincipal: (principal?: GatewayPrincipal) => void;
};

export const useScopeStore = create<ScopeState>((set) => ({
  tenantId: "t_default",
  workspaceId: "w_default",
  userId: "u_legacy",
  scopeKey: "default",
  setTenantId: (tenantId) => set({ tenantId: tenantId.trim() || "t_default" }),
  setWorkspaceId: (workspaceId) => set({ workspaceId: workspaceId.trim() || "w_default" }),
  setUserId: (userId) => set({ userId: userId.trim() || "u_legacy" }),
  setScopeKey: (scopeKey) => set({ scopeKey: scopeKey.trim() || "default" }),
  setFromPrincipal: (principal) =>
    set({
      tenantId: principal?.tenantId ?? "t_default",
      workspaceId: principal?.workspaceIds[0] ?? "w_default",
      userId: principal?.userId ?? "u_legacy"
    })
}));
