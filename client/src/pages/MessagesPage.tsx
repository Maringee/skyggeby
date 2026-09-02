import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  MessageDto,
  MessageParticipantDto,
  MessageSummaryDto,
} from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { IconMail } from '@/components/Icons';
import { MessageCompose } from '@/components/MessageCompose';
import { MessageDetail } from '@/components/MessageDetail';
import { MessageRow } from '@/components/MessageRow';
import { PageHeader } from '@/components/PageHeader';
import { useMessages } from '@/state/MessagesContext';

type Tab = 'innboks' | 'sendt' | 'uleste';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'innboks', label: 'Innboks' },
  { id: 'sendt', label: 'Sendt' },
  { id: 'uleste', label: 'Uleste' },
];

const EMPTY: Record<Tab, string> = {
  innboks: 'Ingen meldinger ennå.',
  sendt: 'Du har ikke sendt noen meldinger ennå.',
  uleste: 'Du har ingen uleste meldinger.',
};

export function MessagesPage() {
  const { unread, setUnread, refresh: refreshBadge } = useMessages();
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('innboks');
  const [inbox, setInbox] = useState<MessageSummaryDto[]>([]);
  const [sent, setSent] = useState<MessageSummaryDto[]>([]);
  const [inboxCursor, setInboxCursor] = useState<string | null>(null);
  const [sentCursor, setSentCursor] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [prefill, setPrefill] = useState<MessageParticipantDto | null>(null);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<MessageDto | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [inn, ut] = await Promise.all([api.messages('innboks'), api.messages('sendt')]);
      setInbox(inn.messages);
      setInboxCursor(inn.nextCursor);
      setSent(ut.messages);
      setSentCursor(ut.nextCursor);
      // The count is the server's, not something the page adds up itself.
      setUnread(inn.unread);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente meldingene dine.');
    } finally {
      setLoading(false);
    }
  }, [setUnread]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Opened from a player's profile: the recipient travels in router state, so
   * the compose form starts filled in and nothing reloads on the way here. The
   * state is cleared immediately, or a later back-navigation would reopen it.
   */
  useEffect(() => {
    const recipient = (location.state as { recipient?: MessageParticipantDto } | null)
      ?.recipient;
    if (!recipient) return;

    setPrefill(recipient);
    setComposeError(null);
    setComposeOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const loadMore = async () => {
    const cursor = tab === 'sendt' ? sentCursor : inboxCursor;
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const box = tab === 'sendt' ? 'sendt' : 'innboks';
      const res = await api.messages(box, cursor);
      if (box === 'sendt') {
        setSent((current) => [...current, ...res.messages]);
        setSentCursor(res.nextCursor);
      } else {
        setInbox((current) => [...current, ...res.messages]);
        setInboxCursor(res.nextCursor);
      }
      setUnread(res.unread);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente flere meldinger.');
    } finally {
      setLoadingMore(false);
    }
  };

  const openMessage = async (messageId: string) => {
    setOpenId(messageId);
    setOpen(null);
    setOpenError(null);
    setOpenLoading(true);

    try {
      const res = await api.message(messageId);
      setOpen(res.message);
      setUnread(res.unread);
    } catch (err) {
      setOpenError(err instanceof ApiError ? err.message : 'Kunne ikke hente meldingen.');
    } finally {
      setOpenLoading(false);
    }
  };

  const send = async (recipientId: string, subject: string, content: string) => {
    if (sending) return;

    setSending(true);
    setComposeError(null);
    setMessage(null);

    try {
      const res = await api.sendMessage(recipientId, subject, content);
      setMessage(res.message);
      setComposeOpen(false);
      setPrefill(null);
      setTab('sendt');
      await load();
    } catch (err) {
      setComposeError(err instanceof ApiError ? err.message : 'Meldingen ble ikke sendt.');
    } finally {
      setSending(false);
    }
  };

  const markRead = async (messageId: string) => {
    if (busy) return;

    setBusy(true);
    setOpenError(null);

    try {
      // Whether it counts as read is the server's answer, never the page's.
      const res = await api.readMessage(messageId);
      setOpen(res.read);
      setUnread(res.unread);
      await load();
    } catch (err) {
      setOpenError(err instanceof ApiError ? err.message : 'Kunne ikke markere meldingen.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (messageId: string) => {
    if (busy) return;

    setBusy(true);
    setOpenError(null);

    try {
      const res = await api.deleteMessage(messageId);
      setUnread(res.unread);
      setMessage(res.message);
      setOpenId(null);
      setOpen(null);
      await load();
    } catch (err) {
      setOpenError(err instanceof ApiError ? err.message : 'Kunne ikke slette meldingen.');
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    if (tab === 'sendt') return sent;
    if (tab === 'uleste') return inbox.filter((item) => !item.read);
    return inbox;
  }, [tab, inbox, sent]);

  const cursor = tab === 'sendt' ? sentCursor : tab === 'innboks' ? inboxCursor : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meldinger"
        title="Postkassa"
        intro="Private meldinger mellom deg og andre spillere."
        aside={
          <button
            type="button"
            onClick={() => {
              setComposeError(null);
              setComposeOpen(true);
            }}
            className="btn-primary"
          >
            Ny melding
          </button>
        }
      />

      <nav
        aria-label="Postkasser"
        className="flex flex-wrap animate-fade-in gap-1 rounded-lg border border-white/[0.06] bg-ink-850/60 p-1"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              tab === item.id
                ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow'
                : 'text-steel-400 hover:text-white'
            }`}
          >
            {item.label}
            {item.id === 'uleste' && unread > 0 && (
              <span className="rounded-full bg-blood-600/90 px-1.5 py-0.5 font-mono text-[0.6rem] text-white">
                {unread}
              </span>
            )}
          </button>
        ))}
      </nav>

      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <section className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : visible.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconMail className="h-6 w-6" />
          </div>
          <p className="text-sm text-steel-400">{EMPTY[tab]}</p>
          {tab !== 'uleste' && (
            <button
              type="button"
              onClick={() => {
                setComposeError(null);
                setComposeOpen(true);
              }}
              className="btn-secondary mt-5"
            >
              Ny melding
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="space-y-3">
            {visible.map((item, index) => (
              <MessageRow
                key={item.id}
                message={item}
                onOpen={openMessage}
                delay={index * 35}
              />
            ))}
          </section>

          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-ghost w-full"
            >
              {loadingMore ? 'Henter ...' : 'Hent flere'}
            </button>
          )}
        </>
      )}

      {composeOpen && (
        <MessageCompose
          initialRecipient={prefill}
          sending={sending}
          error={composeError}
          onSend={send}
          onClose={() => {
            setComposeOpen(false);
            setPrefill(null);
          }}
        />
      )}

      {openId && (
        <MessageDetail
          message={open}
          loading={openLoading}
          busy={busy}
          error={openError}
          onRead={markRead}
          onDelete={remove}
          onClose={() => {
            setOpenId(null);
            setOpen(null);
            void refreshBadge();
          }}
        />
      )}
    </div>
  );
}
