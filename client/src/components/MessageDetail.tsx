import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '@skyggeby/shared';
import type { MessageDto } from '@skyggeby/shared';
import { IconClose, IconMail } from './Icons';

interface MessageDetailProps {
  message: MessageDto | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onRead: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onClose: () => void;
}

export function MessageDetail({
  message,
  loading,
  busy,
  error,
  onRead,
  onDelete,
  onClose,
}: MessageDetailProps) {
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

  const incoming = message?.direction === 'INN';

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
        aria-label={message?.subject ?? 'Melding'}
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-600/35 bg-violet-700/12 text-violet-400">
              <IconMail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="break-words font-display text-xl tracking-[0.1em] text-white">
                {loading ? 'Henter ...' : (message?.subject ?? 'Melding')}
              </h2>
              {message && (
                <p className="label-xs mt-0.5">
                  {incoming ? 'Mottatt melding' : 'Sendt melding'}
                </p>
              )}
            </div>
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

        {loading && !message && (
          <div className="mt-5 space-y-3">
            <div className="h-4 w-1/2 animate-pulse-soft rounded bg-ink-850" />
            <div className="h-24 animate-pulse-soft rounded bg-ink-850" />
          </div>
        )}

        {message && (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-5">
              <div className="min-w-0">
                <dt className="label-xs">Fra</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold">
                  {/* Both names open the player's public profile. */}
                  <Link
                    to={`/spiller/${encodeURIComponent(message.sender.username)}`}
                    onClick={onClose}
                    className="text-white transition hover:text-violet-400 hover:underline"
                  >
                    {message.sender.username}
                  </Link>
                </dd>
              </div>
              <div className="min-w-0 text-right">
                <dt className="label-xs">Til</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold">
                  <Link
                    to={`/spiller/${encodeURIComponent(message.recipient.username)}`}
                    onClick={onClose}
                    className="text-white transition hover:text-violet-400 hover:underline"
                  >
                    {message.recipient.username}
                  </Link>
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="label-xs">Sendt</dt>
                <dd className="mt-0.5 text-sm text-steel-300">
                  {formatDateTime(message.createdAt)}
                  {message.read && message.readAt && (
                    <span className="ml-2 text-xs text-steel-500">
                      · lest {formatDateTime(message.readAt)}
                    </span>
                  )}
                  {incoming && !message.read && (
                    <span className="ml-2 text-xs font-semibold text-blood-400">· ulest</span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Plain text, always. Message bodies are never rendered as HTML. */}
            <p className="mt-5 whitespace-pre-wrap break-words border-t border-white/[0.06] pt-5 text-sm leading-relaxed text-steel-200">
              {message.content}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {incoming && !message.read && (
                <button
                  type="button"
                  onClick={() => onRead(message.id)}
                  disabled={busy}
                  className="btn-primary flex-1"
                >
                  Marker som lest
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(message.id)}
                disabled={busy}
                className="btn-ghost flex-1"
              >
                {busy ? 'Jobber ...' : 'Slett'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
