import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { formatMoney, reputationLabel } from '@skyggeby/shared';
import { Brand } from '@/components/Brand';
import { IconBolt, IconMenu } from '@/components/Icons';
import { Sidebar } from '@/components/nav/Sidebar';
import { useNow } from '@/lib/useNow';
import { projectedEnergy } from '@/lib/vitals';
import { findNavEntry } from '@/nav/navigation';
import { useAuth } from '@/state/AuthContext';
import { MessagesProvider } from '@/state/MessagesContext';
import { MissionsProvider } from '@/state/MissionsContext';

/**
 * Chrome shared by every signed-in page: the permanent navigation, a slim
 * status bar and the routed page itself.
 *
 * Pages render only their own content - none of them owns navigation, and none
 * of them needs to know the others exist.
 */
export function GameLayout() {
  const { player, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const now = useNow(1000);

  // Never leave the drawer open across a navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // The drawer is an overlay; the page behind it must not scroll.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (!player) return null;

  const entry = findNavEntry(location.pathname);
  const energy = projectedEnergy(player, now);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const sidebar = (onNavigate?: () => void, onClose?: () => void) => (
    <Sidebar
      player={player}
      {...(onNavigate ? { onNavigate } : {})}
      {...(onClose ? { onClose } : {})}
      onLogout={handleLogout}
      loggingOut={loggingOut}
    />
  );

  return (
    // The unread count is shared by the navigation badge and the messages page,
    // so it is fetched once here rather than by each of them.
    <MessagesProvider>
      <MissionsProvider>
    <div className="grain min-h-screen lg:pl-64">
      {/* Desktop navigation */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        {sidebar()}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Lukk menyen"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] animate-fade-in shadow-panel">
            {sidebar(
              () => setDrawerOpen(false),
              () => setDrawerOpen(false),
            )}
          </div>
        </div>
      )}

      {/* Status bar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Åpne menyen"
              className="rounded-lg border border-white/[0.08] p-2 text-steel-300 transition
                hover:border-white/20 hover:text-white lg:hidden"
            >
              <IconMenu />
            </button>

            <span className="lg:hidden">
              <Brand size="sm" />
            </span>

            <p className="hidden font-display text-lg tracking-[0.2em] text-white lg:block">
              {(entry?.label ?? 'Skyggeby').toUpperCase()}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4 sm:gap-5">
            <div className="hidden text-right sm:block">
              <p className="label-xs">Rykte</p>
              <p className="text-sm font-semibold text-violet-400">
                {reputationLabel(player.reputation)}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-violet-400" title="Energi">
              <IconBolt className="h-4 w-4" />
              <span className="font-mono text-sm font-semibold tabular-nums">
                {energy}
              </span>
            </div>
            <div className="text-right">
              <p className="label-xs">Kontanter</p>
              <p className="font-mono text-sm font-semibold tabular-nums text-white">
                {formatMoney(player.cash)}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <Outlet />
      </main>
    </div>
      </MissionsProvider>
    </MessagesProvider>
  );
}
