import { createContext, useContext } from 'react';

import type { Auth, Session } from './session';

export interface AuthContextValue {
  auth: Auth;
  session: Session;
  /** The API's base URL (for download links). */
  baseUrl: string;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside a signed-in app.');
  return ctx;
}
