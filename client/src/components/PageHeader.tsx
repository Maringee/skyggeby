import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Small label above the title, e.g. the category name. */
  eyebrow?: string;
  title: string;
  intro?: string;
  /** Optional trailing content, such as a status chip. */
  aside?: ReactNode;
}

/** Consistent heading for every category page. */
export function PageHeader({ eyebrow, title, intro, aside }: PageHeaderProps) {
  return (
    <header className="animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="label-xs">{eyebrow}</p>}
          <h1 className="mt-1 font-display text-3xl tracking-[0.14em] text-white sm:text-4xl">
            {title.toUpperCase()}
          </h1>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {intro && <p className="mt-2 max-w-2xl text-sm text-steel-400">{intro}</p>}
    </header>
  );
}
