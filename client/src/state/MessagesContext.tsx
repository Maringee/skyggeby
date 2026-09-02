import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/api/endpoints';

interface MessagesContextValue {
  /** Unread messages waiting, as last reported by the server. */
  unread: number;
  /** Re-reads the count. Called after anything that could change it. */
  refresh: () => Promise<void>;
  /** Lets a page that already has a fresh count skip a round trip. */
  setUnread: (count: number) => void;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

/** Quiet background refresh. Often enough to notice, rare enough to ignore. */
const POLL_MS = 60_000;

/**
 * Keeps the unread-message badge current.
 *
 * The count is never derived in the browser: it is whatever the server last
 * said, refreshed on a slow timer, whenever the tab becomes visible again, and
 * immediately after the player reads or deletes something.
 */
export function MessagesProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await api.unreadMessages();
      setUnread(res.count);
    } catch {
      // A failed badge refresh is not worth interrupting anyone over; the
      // next tick will pick it up.
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      // No point polling a tab nobody is looking at.
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value = useMemo<MessagesContextValue>(
    () => ({ unread, refresh, setUnread }),
    [unread, refresh],
  );

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

/**
 * Reads the badge state.
 *
 * Falls back to a dormant value rather than throwing, so a component can be
 * rendered outside the provider (a login screen, a test) without exploding.
 */
export function useMessages(): MessagesContextValue {
  const ctx = useContext(MessagesContext);
  if (ctx) return ctx;
  return { unread: 0, refresh: async () => {}, setUnread: () => {} };
}
