import { useEffect, useState } from 'react';

/**
 * Re-renders on a fixed interval so countdowns and regenerating bars stay
 * truthful between requests. Pass `active: false` to stop the timer when
 * nothing on screen is actually ticking.
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);

  return now;
}
