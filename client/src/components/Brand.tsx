import { GAME_NAME, GAME_TAGLINE } from '@skyggeby/shared';

export function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const scale = {
    sm: 'text-2xl',
    md: 'text-4xl',
    lg: 'text-6xl sm:text-7xl',
  }[size];

  return (
    <div className="select-none">
      <div className="flex items-baseline gap-3">
        <span className={`font-display tracking-[0.22em] text-white ${scale} animate-flicker`}>
          SKYGGE
        </span>
        <span
          className={`font-display tracking-[0.22em] text-blood-500 text-glow-red ${scale}`}
        >
          BY
        </span>
      </div>
      {size !== 'sm' && (
        <p className="mt-1 text-xs uppercase tracking-[0.42em] text-steel-500">
          {GAME_TAGLINE}
        </p>
      )}
      <span className="sr-only">{GAME_NAME}</span>
    </div>
  );
}
