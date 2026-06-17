"use client";

import { createContext, useContext } from "react";

/** 与真实登录实现对齐的最小用户形状（当前 Provider 仍为占位 stub） */
export interface AuthUser {
  id?: number | string;
  username: string;
  role?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isAdmin: boolean;
}

const stub: AuthContextValue = {
  user: null,
  loading: false,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
  isAdmin: false,
};

const AuthContext = createContext<AuthContextValue>(stub);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthContext.Provider value={stub}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
