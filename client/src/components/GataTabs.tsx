import { NavLink } from 'react-router-dom';
import { NAV_ENTRIES } from '@/nav/navigation';

/**
 * Sub-navigation within a category. Reads the same central config as the
 * sidebar, so a new page under a category appears here without any change.
 */
export function SectionTabs({ section }: { section: string }) {
  const entry = NAV_ENTRIES.find((item) => item.to === section);
  if (!entry?.children) return null;

  return (
    <nav
      aria-label={`Undernavigasjon for ${entry.label}`}
      // Wraps rather than overflowing: Økonomi has four tabs, which do not fit
      // on one line on a phone.
      className="flex flex-wrap animate-fade-in gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1"
    >
      {entry.children.map((child) => (
        <NavLink
          key={child.to}
          to={child.to}
          end
          className={({ isActive }) =>
            `rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              isActive
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow'
                : 'text-steel-400 hover:text-white'
            }`
          }
        >
          {child.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Convenience wrapper kept so Gata pages read clearly. */
export function GataTabs() {
  return <SectionTabs section="/gata" />;
}
