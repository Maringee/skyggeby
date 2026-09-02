import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginPayload, PlayerDto, RegisterPayload } from '@skyggeby/shared';
import { api } from '@/api/endpoints';
import { ApiError } from '@/api/client';

interface AuthContextValue {
  player: PlayerDto | null;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  /** Replaces the cached player with a fresh, server-authoritative snapshot. */
  setPlayer: (player: PlayerDto) => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<PlayerDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    api
      .me(controller.signal)
      .then((res) => setPlayer(res.player))
      .catch((error) => {
        // A 401 here is normal: it just means nobody is logged in yet.
        if (!(error instanceof ApiError) || error.status !== 401) {
          console.warn('Kunne ikke hente økt:', error);
        }
        setPlayer(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const res = await api.login(payload);
    setPlayer(res.player);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const res = await api.register(payload);
    setPlayer(res.player);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setPlayer(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await api.profile();
    setPlayer(res.player);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ player, loading, login, register, logout, setPlayer, refresh }),
    [player, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth må brukes innenfor AuthProvider.');
  return ctx;
}
