import { useEffect } from 'react';
import { formatDateTime, formatRelativeTime } from '@skyggeby/shared';
import type { ContactDto } from '@skyggeby/shared';
import { TrustBar } from './ContactCard';
import { IconClose, IconLock, IconMap, IconUser } from './Icons';

interface ContactDetailProps {
  contact: ContactDto;
  busy: boolean;
  onContact: (contactId: string) => void;
  onClose: () => void;
}

/**
 * Signals for systems that do not exist yet. Rendered locked on purpose so the
 * player can see where the network is going, without anything behind them.
 */
const UPCOMING = [
  { label: 'Be om informasjon', hint: 'Ikke tilgjengelig ennå' },
  { label: 'Be om tjeneste', hint: 'Ikke tilgjengelig ennå' },
];

export function ContactDetail({ contact, busy, onContact, onClose }: ContactDetailProps) {
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
        aria-label={contact.name}
        className="panel panel-edge relative my-auto w-full max-w-lg animate-fade-up p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-violet-600/35 bg-violet-700/12 text-violet-400">
              <IconUser className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl tracking-[0.12em] text-white">
                {contact.name}
              </h2>
              <p className="label-xs mt-0.5">{contact.role}</p>
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

        <p className="mt-3 flex items-center gap-1.5 text-sm text-steel-400">
          <IconMap className="h-4 w-4" />
          {contact.districtName}
        </p>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-xs">Tillit</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-white">
              {contact.trust} / 100
            </span>
          </div>
          <div className="mt-2">
            <TrustBar trust={contact.trust} label={contact.trustLabel} />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <dt className="label-xs">Forhold</dt>
              <dd className="mt-0.5 text-sm font-semibold text-white">
                {contact.trustLabel}
              </dd>
              <dd className="mt-0.5 text-xs text-steel-500">{contact.trustDescription}</dd>
            </div>
            <div>
              <dt className="label-xs">Status</dt>
              <dd
                className={`mt-0.5 text-sm font-semibold ${
                  contact.canContact ? 'text-neon' : 'text-steel-400'
                }`}
              >
                {contact.statusLabel}
              </dd>
              <dd className="mt-0.5 text-xs text-steel-500">
                {contact.lastInteractionAt
                  ? `Sist kontakt ${formatRelativeTime(contact.lastInteractionAt)}`
                  : 'Dere har ikke snakket sammen ennå'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <p className="text-sm leading-relaxed text-steel-300">{contact.description}</p>
          {contact.specialisations.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {contact.specialisations.map((item) => (
                <li
                  key={item}
                  className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1 text-[0.68rem] text-steel-400"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-steel-500">
            Kjent siden {formatDateTime(contact.discoveredAt)}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onContact(contact.id)}
          disabled={!contact.canContact || busy}
          className={`btn mt-5 w-full ${
            contact.canContact
              ? 'bg-gradient-to-r from-blood-600 to-blood-500 text-white shadow-glow hover:from-blood-500 hover:to-blood-400'
              : 'border border-white/[0.08] bg-white/[0.02] text-steel-500'
          }`}
        >
          {busy ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Snakker ...
            </>
          ) : (
            'Kontakt'
          )}
        </button>

        <div className="mt-5 border-t border-white/[0.06] pt-5">
          <p className="label-xs">Muligheter</p>
          <ul className="mt-3 space-y-2">
            {UPCOMING.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <span className="text-sm text-steel-400">{item.label}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-steel-500">
                  <IconLock className="h-3.5 w-3.5" />
                  {item.hint}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
