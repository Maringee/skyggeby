import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLAYER_SEARCH, formatNumber } from '@skyggeby/shared';
import type { PlayerSearchResultDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { IconMap, IconSearch, IconUser } from './Icons';

/**
 * Finds other players by name.
 *
 * Debounced on purpose: a search is a database scan, and one request per
 * keystroke is a good way to spend a rate limit on nothing. Nothing is sent
 * before the server's own minimum length is met.
 */
export function PlayerSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerSearchResultDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();

    if (term.length < PLAYER_SEARCH.minLength) {
      setResults([]);
      setSearched(false);
      setError(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(() => {
      api
        .searchPlayers(term)
        .then((res) => {
          if (cancelled) return;
          setResults(res.players);
          setSearched(true);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          setSearched(true);
          setError(err instanceof ApiError ? err.message : 'Søket mislyktes. Prøv igjen.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const tooShort = query.trim().length > 0 && query.trim().length < PLAYER_SEARCH.minLength;

  return (
    <section className="panel panel-edge animate-fade-up p-6">
      <h2 className="font-display text-lg tracking-[0.16em] text-white">
        SØK ETTER SPILLER
      </h2>
      <p className="mt-1 text-xs text-steel-500">
        Finn andre i byen og åpne profilen deres.
      </p>

      <div className="relative mt-4">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
        <input
          type="text"
          value={query}
          maxLength={PLAYER_SEARCH.maxLength}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk ..."
          aria-label="Søk etter spiller"
          className="w-full rounded-lg border border-white/[0.08] bg-ink-900/70 py-3 pl-9 pr-4
            text-sm text-white outline-none transition placeholder:text-steel-600
            focus:border-violet-500/60"
        />
      </div>

      {tooShort && (
        <p className="mt-2 text-xs text-steel-500">
          Skriv minst {PLAYER_SEARCH.minLength} tegn.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-blood-400">{error}</p>}

      {searching && !tooShort && (
        <p className="mt-3 text-xs text-steel-500">Søker ...</p>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <p className="mt-3 text-sm text-steel-400">Ingen spillere funnet.</p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((player) => (
            <li key={player.id}>
              <Link
                to={`/spiller/${encodeURIComponent(player.username)}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3
                  transition hover:border-white/[0.14] hover:bg-white/[0.04]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-600/35 bg-violet-700/12 text-violet-400">
                  <IconUser className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {player.username}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-steel-500">
                    Nivå {formatNumber(player.level)} ·
                    <IconMap className="h-3.5 w-3.5" />
                    {player.districtName}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
