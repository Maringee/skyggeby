import { Brand } from './Brand';

export function LoadingScreen({ text = 'Kobler til byen ...' }: { text?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <Brand size="md" />
      <div className="relative h-[3px] w-56 overflow-hidden rounded-full bg-ink-800">
        <div className="absolute inset-y-0 w-1/3 animate-sweep rounded-full bg-gradient-to-r from-transparent via-blood-500 to-transparent" />
      </div>
      <p className="animate-pulse-soft text-xs uppercase tracking-[0.32em] text-steel-500">
        {text}
      </p>
    </div>
  );
}
