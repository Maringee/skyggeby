import { NavLink, useLocation } from 'react-router-dom';
import { formatMoney } from '@skyggeby/shared';
import type { PlayerDto } from '@skyggeby/shared';
import { Brand } from '@/components/Brand';
import { IconClose, IconLogout } from '@/components/Icons';
import { NAV_ENTRIES, findNavEntry, type NavEntry } from '@/nav/navigation';
import { useMessages } from '@/state/MessagesContext';
import { useMissions } from '@/state/MissionsContext';

interface SidebarProps {
  player: PlayerDto;
  /** Called after any navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  onClose?: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

/**
 * The permanent main navigation. Rendered twice by GameLayout: once fixed on
 * desktop, once inside the mobile drawer. Entries come from the central
 * navigation config, so a new category never means touching this file.
 */
export function Sidebar({
  player,
  onNavigate,
  onClose,
  onLogout,
  loggingOut,
}: SidebarProps) {
  const location = useLocation();
  const activeEntry = findNavEntry(location.pathname);
  // Server-reported, never counted in the browser.
  const { unread } = useMessages();
  // Counts what can be handed in, not what is active: a badge that never
  // changes is decoration.
  const { deliverable } = useMissions();
  const isSection = (entry: NavEntry) => activeEntry?.to === entry.to;

  return (
    <div className="flex h-full flex-col border-r border-white/[0.06] bg-ink-950/95">
      <div className="flex items-start justify-between gap-2 px-5 pb-5 pt-5">
        <NavLink to="/dashbord" onClick={onNavigate}>
          <Brand size="sm" />
        </NavLink>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk menyen"
            className="rounded-lg border border-white/[0.08] p-2 text-steel-400 transition
              hover:border-white/20 hover:text-white lg:hidden"
          >
            <IconClose />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Hovednavigasjon">
        <ul className="space-y-1">
          {NAV_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            // Follows the resolved category rather than the raw path, so a page
            // inside a category still lights up its parent.
            const active = isSection(entry);

            return (
              <li key={entry.to}>
                <NavLink
                  to={entry.to}
                  onClick={onNavigate}
                  // The highlight marks the section; `aria-current` is left to
                  // the sub-item so exactly one link claims to be the page.
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition
                     ${
                       active
                         ? 'bg-gradient-to-r from-blood-700/25 to-transparent text-white'
                         : 'text-steel-400 hover:bg-white/[0.03] hover:text-white'
                     }`}
                >
                  <span
                    className={`absolute inset-y-1.5 left-0 w-[3px] rounded-full transition
                      ${active ? 'bg-blood-500 shadow-glow' : 'bg-transparent'}`}
                    aria-hidden="true"
                  />
                  <Icon
                    className={`h-[18px] w-[18px] shrink-0 transition
                      ${active ? 'text-blood-400' : 'text-steel-500 group-hover:text-violet-400'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-sm tracking-[0.16em]">
                      {entry.label.toUpperCase()}
                    </span>
                    <span className="block truncate text-[0.68rem] text-steel-500">
                      {entry.description}
                    </span>
                  </span>
                  {entry.to === '/meldinger' && unread > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-1.5 rounded-full bg-blood-600/90 px-2 py-0.5
                        font-mono text-[0.62rem] font-semibold text-white shadow-glow"
                      aria-label={`${unread} uleste meldinger`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                      {unread}
                    </span>
                  )}
                  {entry.to === '/oppdrag' && deliverable > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-1.5 rounded-full bg-neon/20 px-2 py-0.5
                        font-mono text-[0.62rem] font-semibold text-neon"
                      aria-label={`${deliverable} oppdrag klare til levering`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-neon" aria-hidden="true" />
                      {deliverable}
                    </span>
                  )}
                  {entry.upcoming && (
                    <span className="shrink-0 rounded border border-violet-600/40 bg-violet-700/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-violet-400">
                      Snart
                    </span>
                  )}
                </NavLink>

                {entry.children && active && (
                  <ul className="mb-1 ml-[34px] mt-0.5 space-y-0.5 border-l border-white/[0.07] pl-3">
                    {entry.children.map((child) => (
                      <li key={child.to}>
                        <NavLink
                          to={child.to}
                          end
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            `block rounded px-2 py-1.5 text-[0.78rem] transition ${
                              isActive
                                ? 'text-blood-400'
                                : 'text-steel-500 hover:text-white'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{player.username}</p>
            <p className="font-mono text-[0.68rem] text-steel-500">
              Nivå {player.level} · {formatMoney(player.cash)}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            title="Logg ut"
            aria-label="Logg ut"
            className="shrink-0 rounded-lg border border-white/[0.08] p-2 text-steel-400 transition
              hover:border-blood-600/50 hover:text-blood-400 disabled:opacity-40"
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </div>
  );
}
