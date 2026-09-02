import { Link } from 'react-router-dom';
import { formatRelativeTime } from '@skyggeby/shared';
import type { MessageSummaryDto } from '@skyggeby/shared';
import { IconMail, IconUser } from './Icons';

interface MessageRowProps {
  message: MessageSummaryDto;
  onOpen: (messageId: string) => void;
  delay: number;
}

/**
 * One row in the inbox or sent box.
 *
 * The other party's name is a link to their profile rather than part of the
 * open-the-message button - a link inside a button is neither valid nor
 * clickable, so the row is split into the two things it actually offers.
 *
 * Subject, preview and names are rendered as plain text; message content is
 * never interpreted as markup.
 */
export function MessageRow({ message, onOpen, delay }: MessageRowProps) {
  const incoming = message.direction === 'INN';
  const other = incoming ? message.sender : message.recipient;
  const unread = incoming && !message.read;

  return (
    <article
      style={{ animationDelay: `${delay}ms` }}
      className={`panel flex animate-fade-up items-start gap-3 p-4 transition
        hover:border-white/[0.14] ${unread ? 'border-violet-600/35 bg-violet-700/[0.06]' : ''}`}
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
          unread
            ? 'border-violet-600/40 bg-violet-700/15 text-violet-400'
            : 'border-white/[0.08] bg-white/[0.02] text-steel-500'
        }`}
      >
        {incoming ? <IconMail className="h-4 w-4" /> : <IconUser className="h-4 w-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(message.id)}
          className="block w-full text-left"
        >
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-2">
              {unread && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-blood-500 shadow-glow"
                  aria-label="Ulest"
                />
              )}
              <span
                className={`truncate text-sm ${
                  unread ? 'font-semibold text-white' : 'text-steel-200'
                }`}
              >
                {message.subject}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[0.68rem] text-steel-500">
              {formatRelativeTime(message.createdAt)}
            </span>
          </span>
        </button>

        <p className="mt-1 text-xs text-steel-500">
          {incoming ? 'Fra' : 'Til'}{' '}
          <Link
            to={`/spiller/${encodeURIComponent(other.username)}`}
            className="font-semibold text-violet-400 transition hover:text-violet-300 hover:underline"
          >
            {other.username}
          </Link>
        </p>

        <button
          type="button"
          onClick={() => onOpen(message.id)}
          className="mt-1.5 block w-full truncate text-left text-xs text-steel-400"
        >
          {message.preview}
        </button>
      </div>
    </article>
  );
}
