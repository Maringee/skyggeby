import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MissionDto } from '@skyggeby/shared';
import { api } from '@/api/endpoints';

interface MissionsContextValue {
  /** Missions that can be handed in right now, as the server last reported. */
  deliverable: number;
  /** The running missions themselves, for the dashboard panel. */
  active: MissionDto[];
  refresh: () => Promise<void>;
  /** Lets a page that already has a fresh count skip a round trip. */
  setDeliverable: (count: number) => void;
  /** Lets the mission page hand over the list it just fetched. */
  setActive: (missions: MissionDto[]) => void;
}

const MissionsContext = createContext<MissionsContextValue | null>(null);

/** Quiet background refresh, matching the message badge. */
const POLL_MS = 60_000;

/**
 * Keeps the mission badge current.
 *
 * The badge deliberately counts what can be *delivered*, not what is active. A
 * number that sits at three whether or not anything has happened is decoration;
 * one that lights up when there is something to collect is information.
 *
 * The count is never worked out in the browser - it is whatever the server last
 * said, since only the server can judge whether an objective is met.
 */
export function MissionsProvider({ children }: { children: ReactNode }) {
  const [deliverable, setDeliverable] = useState(0);
  const [active, setActive] = useState<MissionDto[]>([]);

  const refresh = useCallback(async () => {
    try {
      // One call feeds both the badge and the dashboard panel. The response
      // already carries everything either of them needs, so neither adds a
      // round trip of its own.
      const res = await api.missions();
      setDeliverable(res.deliverableCount);
      setActive(res.missions.filter((mission) => mission.availability === 'AKTIV'));
    } catch {
      // A failed badge refresh is not worth interrupting anyone over.
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
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

  const value = useMemo<MissionsContextValue>(
    () => ({ deliverable, active, refresh, setDeliverable, setActive }),
    [deliverable, active, refresh],
  );

  return <MissionsContext.Provider value={value}>{children}</MissionsContext.Provider>;
}

/** Falls back to a dormant value outside the provider, like the message badge. */
export function useMissions(): MissionsContextValue {
  const ctx = useContext(MissionsContext);
  if (ctx) return ctx;
  return {
    deliverable: 0,
    active: [],
    refresh: async () => {},
    setDeliverable: () => {},
    setActive: () => {},
  };
}
