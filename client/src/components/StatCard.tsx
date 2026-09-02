import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'red' | 'violet' | 'green' | 'steel';
  icon?: ReactNode;
  children?: ReactNode;
  delay?: number;
}

const ACCENTS = {
  red: 'from-blood-600/25 to-transparent text-blood-400',
  violet: 'from-violet-600/25 to-transparent text-violet-400',
  green: 'from-emerald-600/20 to-transparent text-neon',
  steel: 'from-white/[0.06] to-transparent text-steel-300',
} as const;

export function StatCard({
  label,
  value,
  sub,
  accent = 'steel',
  icon,
  children,
  delay = 0,
}: StatCardProps) {
  return (
    <article
      className="panel panel-edge group animate-fade-up overflow-hidden p-5 transition
        hover:border-white/[0.12] hover:shadow-glow-violet"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0
          transition-opacity duration-500 group-hover:opacity-100 ${ACCENTS[accent]}`}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="label-xs">{label}</span>
          {icon && <span className={`opacity-70 ${ACCENTS[accent].split(' ').pop()}`}>{icon}</span>}
        </div>
        <p className="stat-value mt-2">{value}</p>
        {sub && <p className="mt-1 text-xs text-steel-500">{sub}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </article>
  );
}
