import { Link } from 'react-router-dom';
import { Brand } from '@/components/Brand';
import { IconChevron } from '@/components/Icons';

const PILLARS = [
  {
    title: 'Alt bokføres',
    body: 'Hver krone som beveger seg får sin egen linje i regnskapet. Ingen kan trylle fram penger.',
  },
  {
    title: 'Serveren bestemmer',
    body: 'Nettleseren din spør. Serveren svarer. Det er den som eier sannheten om formuen din.',
  },
  {
    title: 'Byen husker',
    body: 'Rykte og heat følger deg. Det du gjør i dag former hvem som stoler på deg i morgen.',
  },
];

export function LandingPage() {
  return (
    <div className="grain relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blood-600/60 to-transparent" />

      <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
        <div className="animate-fade-up">
          <p className="label-xs mb-6">Nattens økonomi · Norsk nettspill</p>
          <Brand size="lg" />
        </div>

        <p
          className="mt-8 max-w-xl animate-fade-up text-lg leading-relaxed text-steel-300"
          style={{ animationDelay: '90ms' }}
        >
          Du starter med en lomme full av kontanter og ingenting å miste. Bygg
          formue, hold hodet kaldt og pass på at ikke byen legger merke til deg
          for tidlig.
        </p>

        <div
          className="mt-10 flex animate-fade-up flex-wrap gap-3"
          style={{ animationDelay: '160ms' }}
        >
          <Link to="/registrer" className="btn-primary">
            Opprett spiller
            <IconChevron className="h-4 w-4" />
          </Link>
          <Link to="/logg-inn" className="btn-ghost">
            Logg inn
          </Link>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((pillar, i) => (
            <div
              key={pillar.title}
              className="panel panel-edge animate-fade-up p-5"
              style={{ animationDelay: `${240 + i * 80}ms` }}
            >
              <h2 className="font-display text-xl tracking-[0.14em] text-white">
                {pillar.title.toUpperCase()}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-steel-400">{pillar.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-16 text-xs text-steel-500">
          SKYGGEBY er et fiktivt strategispill. All handling foregår i en oppdiktet by.
        </p>
      </main>
    </div>
  );
}
