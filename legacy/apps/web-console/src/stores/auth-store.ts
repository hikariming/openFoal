import { create } from "zustand";
import {
  GatewayRpcError,
  getGatewayClient,
  type GatewayPrincipal
} from "../lib/gateway-client";
import { useScopeStore } from "./scope-store";

type LoginInput = {
  tenant: string;
  username: string;
  password: string;
};

type AuthState = {
  checking: boolean;
  loading: boolean;
  authenticated: boolean;
  principal?: GatewayPrincipal;
  error?: string;
  bootstrap: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
};

const REFRESH_TOKEN_KEY = "openfoal_refresh_token";

export const useAuthStore = create<AuthState>((set) => ({
  checking: true,
  loading: false,
  authenticated: false,
  principal: undefined,
  error: undefined,
  bootstrap: async () => {
    const client = getGatewayClient();
    const hasToken = Boolean(client.getAccessToken());
    set({ checking: true, error: undefined });

    try {
      if (hasToken) {
        await client.me();
      }
      const principal = await client.ensureConnected();
      useScopeStore.getState().setFromPrincipal(principal);
      set({
        checking: false,
        authenticated: true,
        principal,
        error: undefined
      });
      return;
    } catch (error) {
      if (hasToken) {
        client.setAccessToken(undefined);
        clearStoredRefreshToken();
      }
      set({
        checking: false,
        authenticated: false,
        principal: undefined,
        error: hasToken ? toErrorMessage(error) : undefined
      });
    }
  },
  login: async (input) => {
    const client = getGatewayClient();
    set({ loading: true, error: undefined });
    try {
      const payload = await client.login({
        username: input.username.trim(),
        password: input.password,
        tenant: input.tenant.trim() || undefined
      });
      const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : undefined;
      if (refreshToken) {
        storeRefreshToken(refreshToken);
      } else {
        clearStoredRefreshToken();
      }
      const principal = await client.ensureConnected();
      useScopeStore.getState().setFromPrincipal(principal);
      set({
        loading: false,
        checking: false,
        authenticated: true,
        principal,
        error: undefined
      });
    } catch (error) {
      set({
        loading: false,
        checking: false,
        authenticated: false,
        principal: undefined,
        error: toErrorMessage(error)
      });
      throw error;
    }
  },
  logout: async () => {
    const client = getGatewayClient();
    set({ loading: true, error: undefined });
    try {
      await client.logout(readStoredRefreshToken());
    } catch {
      // ignore server-side logout failure for local sign-out.
    } finally {
      clearStoredRefreshToken();
      useScopeStore.getState().setFromPrincipal(undefined);
      set({
        loading: false,
        authenticated: false,
        principal: undefined,
        checking: false,
        error: undefined
      });
    }
  },
  clearError: () => set({ error: undefined })
}));

function readStoredRefreshToken(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const value = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function storeRefreshToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

function clearStoredRefreshToken(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof GatewayRpcError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
