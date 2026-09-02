import { Link } from 'react-router-dom';
import { Brand } from '@/components/Brand';

export function NotFoundPage() {
  return (
    <div className="grain flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Brand size="md" />
      <p className="font-display text-7xl tracking-[0.2em] text-blood-600">404</p>
      <p className="max-w-sm text-sm text-steel-400">
        Denne gata finnes ikke. Kanskje den ble revet, kanskje den aldri fantes.
      </p>
      <Link to="/" className="btn-ghost">
        Tilbake til forsiden
      </Link>
    </div>
  );
}
