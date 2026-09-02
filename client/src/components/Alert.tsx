import type { ReactNode } from 'react';

type AlertTone = 'error' | 'success' | 'info';

const TONES: Record<AlertTone, string> = {
  error: 'border-blood-600/45 bg-blood-700/15 text-blood-400',
  success: 'border-emerald-500/40 bg-emerald-600/10 text-neon',
  info: 'border-violet-600/40 bg-violet-700/12 text-violet-400',
};

export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`animate-fade-in rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
