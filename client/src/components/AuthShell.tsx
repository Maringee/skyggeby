import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';

interface AuthShellProps {
  title: string;
  intro: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthShell({ title, intro, children, footer }: AuthShellProps) {
  return (
    <div className="grain flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 inline-block">
          <Brand size="md" />
        </Link>

        <section className="panel panel-edge animate-fade-up p-7">
          <h1 className="font-display text-3xl tracking-[0.16em] text-white">
            {title.toUpperCase()}
          </h1>
          <p className="mt-2 text-sm text-steel-400">{intro}</p>

          <div className="mt-6">{children}</div>
        </section>

        <p className="mt-6 text-center text-sm text-steel-400">{footer}</p>
      </div>
    </div>
  );
}
