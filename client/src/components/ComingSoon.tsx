import type { ReactNode } from 'react';

interface ComingSoonProps {
  title: string;
  /** What the system will do once it exists. */
  body: string;
  icon?: ReactNode;
  /** Bullet points describing the planned scope. */
  planned?: string[];
}

/** Placeholder for a category whose system has not been built yet. */
export function ComingSoon({ title, body, icon, planned }: ComingSoonProps) {
  return (
    <section className="panel panel-edge animate-fade-up p-8 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
          {icon}
        </div>
      )}

      <p className="inline-block rounded-md border border-violet-600/40 bg-violet-700/15 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-violet-400">
        Kommer snart
      </p>

      <h2 className="mt-4 font-display text-2xl tracking-[0.16em] text-white">
        {title.toUpperCase()}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-steel-400">{body}</p>

      {planned && planned.length > 0 && (
        <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left">
          {planned.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-steel-400"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blood-600" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
