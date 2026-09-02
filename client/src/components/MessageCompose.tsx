import { useEffect, useState } from 'react';
import { MESSAGE_LIMITS } from '@skyggeby/shared';
import type { MessageParticipantDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { IconClose, IconSearch } from './Icons';

interface MessageComposeProps {
  /** Preselected recipient, e.g. when opened from a player's profile. */
  initialRecipient?: MessageParticipantDto | null;
  sending: boolean;
  error: string | null;
  onSend: (recipientId: string, subject: string, content: string) => void;
  onClose: () => void;
}

/**
 * The compose form.
 *
 * The recipient is picked from a server-side lookup rather than typed straight
 * into the request: the browser never invents an id, it only relays one the
 * server handed it.
 */
export function MessageCompose({
  initialRecipient,
  sending,
  error,
  onSend,
  onClose,
}: MessageComposeProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageParticipantDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<MessageParticipantDto | null>(
    initialRecipient ?? null,
  );

  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Debounced, so typing a name is one request and not one per keystroke.
  useEffect(() => {
    const term = query.trim();
    if (recipient || term.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = window.setTimeout(() => {
      api
        .findRecipients(term)
        .then((res) => {
          if (!cancelled) {
            setResults(res.players);
            setSearchError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setResults([]);
            setSearchError(
              err instanceof ApiError ? err.message : 'Søket mislyktes. Prøv igjen.',
            );
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, recipient]);

  const subjectOk =
    subject.trim().length >= MESSAGE_LIMITS.subjectMin &&
    subject.trim().length <= MESSAGE_LIMITS.subjectMax;
  const contentOk =
    content.trim().length >= MESSAGE_LIMITS.contentMin &&
    content.trim().length <= MESSAGE_LIMITS.contentMax;
  const ready = recipient !== null && subjectOk && contentOk && !sending;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label="Lukk"
        onClick={onClose}
        className="fixed inset-0 animate-fade-in bg-black/75 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-label="Ny melding"
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl tracking-[0.16em] text-white">
              NY MELDING
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              Meldinger går rett til én spiller. Ingen andre ser dem.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk"
            className="rounded-lg border border-white/[0.08] p-2 text-steel-400 transition
              hover:border-white/20 hover:text-white"
          >
            <IconClose />
          </button>
        </div>

        {error && (
          <p className="mt-5 rounded-lg border border-blood-600/40 bg-blood-700/10 px-4 py-3 text-sm text-blood-300">
            {error}
          </p>
        )}

        <div className="mt-5">
          <span className="label-xs">Mottaker</span>
          {recipient ? (
            <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-violet-600/35 bg-violet-700/10 px-4 py-3">
              <span className="truncate text-sm font-semibold text-white">
                {recipient.username}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRecipient(null);
                  setQuery('');
                }}
                className="shrink-0 text-xs text-steel-400 transition hover:text-white"
              >
                Bytt
              </button>
            </div>
          ) : (
            <>
              <div className="relative mt-1.5">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-500" />
                <input
                  type="text"
                  value={query}
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Søk etter spillernavn"
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/70 py-3 pl-9 pr-4
                    text-sm text-white outline-none transition placeholder:text-steel-600
                    focus:border-violet-500/60"
                />
              </div>

              {searchError && (
                <p className="mt-1.5 text-xs text-blood-400">{searchError}</p>
              )}

              {query.trim().length >= 2 && (
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/[0.06]">
                  {searching ? (
                    <li className="px-4 py-3 text-xs text-steel-500">Søker ...</li>
                  ) : results.length === 0 ? (
                    <li className="px-4 py-3 text-xs text-steel-500">
                      Ingen spillere med det navnet.
                    </li>
                  ) : (
                    results.map((player) => (
                      <li key={player.id}>
                        <button
                          type="button"
                          onClick={() => setRecipient(player)}
                          className="block w-full px-4 py-2.5 text-left text-sm text-steel-200
                            transition hover:bg-white/[0.04] hover:text-white"
                        >
                          {player.username}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </>
          )}
        </div>

        <label className="mt-4 block">
          <span className="label-xs">Emne</span>
          <input
            type="text"
            value={subject}
            maxLength={MESSAGE_LIMITS.subjectMax}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Hva gjelder det?"
            className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-900/70 px-4 py-3
              text-sm text-white outline-none transition placeholder:text-steel-600
              focus:border-violet-500/60"
          />
        </label>

        <label className="mt-4 block">
          <span className="label-xs">Melding</span>
          <textarea
            value={content}
            rows={6}
            maxLength={MESSAGE_LIMITS.contentMax}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Skriv meldingen din"
            className="mt-1.5 w-full resize-y rounded-lg border border-white/[0.08] bg-ink-900/70 px-4 py-3
              text-sm leading-relaxed text-white outline-none transition placeholder:text-steel-600
              focus:border-violet-500/60"
          />
          <span className="mt-1.5 block text-right text-xs text-steel-500">
            {content.trim().length} / {MESSAGE_LIMITS.contentMax}
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={onClose} className="btn-ghost flex-1">
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => onSend(recipient!.id, subject.trim(), content.trim())}
            disabled={!ready}
            className="btn-primary flex-1"
          >
            {sending ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Sender ...
              </>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
