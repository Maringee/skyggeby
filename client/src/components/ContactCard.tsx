import { formatRelativeTime } from '@skyggeby/shared';
import type { ContactDto, MissionDto } from '@skyggeby/shared';
import { IconChevron, IconMap, IconUser } from './Icons';

interface ContactCardProps {
  contact: ContactDto;
  /** This person's missions, as the server reported them. */
  missions: MissionDto[];
  busy: boolean;
  anyBusy: boolean;
  onContact: (contactId: string) => void;
  onOpen: (contactId: string) => void;
  delay: number;
}

const TRUST_TONE: Record<string, string> = {
  Ukjent: 'from-steel-500 to-steel-400',
  Bekjent: 'from-orange-700 via-amber to-yellow-300',
  Kontakt: 'from-violet-700 via-violet-600 to-violet-400',
  Betrodd: 'from-emerald-700 via-emerald-500 to-neon',
  'Nær kontakt': 'from-blood-700 via-blood-500 to-blood-400',
};

const TRUST_TEXT: Record<string, string> = {
  Ukjent: 'text-steel-400',
  Bekjent: 'text-amber',
  Kontakt: 'text-violet-400',
  Betrodd: 'text-neon',
  'Nær kontakt': 'text-blood-400',
};

/** Ten segments, so trust reads as a relationship rather than a raw stat. */
export function TrustBar({ trust, label }: { trust: number; label: string }) {
  const filled = Math.round((trust / 100) * 10);

  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-[1px] ${
            i < filled
              ? `bg-gradient-to-r ${TRUST_TONE[label] ?? TRUST_TONE.Ukjent}`
              : 'bg-ink-750'
          }`}
        />
      ))}
    </div>
  );
}

export function ContactCard({
  contact,
  missions,
  busy,
  anyBusy,
  onContact,
  onOpen,
  delay,
}: ContactCardProps) {
  // One line, not a list: the card is a summary and the dialog is the detail.
  // Work you can hand in outranks work you could start.
  const ready = missions.filter((m) => m.deliverable).length;
  const open = missions.filter((m) => m.availability === 'TILGJENGELIG').length;

  const missionLine =
    ready > 0
      ? { text: `${ready} oppdrag klart til levering`, tone: 'text-neon' }
      : open > 0
        ? {
            text: open === 1 ? 'Har et oppdrag til deg' : `Har ${open} oppdrag til deg`,
            tone: 'text-violet-400',
          }
        : null;

  return (
    <article
      className="panel group animate-fade-up p-5 transition hover:border-white/[0.14]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <button
        type="button"
        onClick={() => onOpen(contact.id)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-600/35 bg-violet-700/12 text-violet-400">
            <IconUser className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg tracking-[0.1em] text-white">
              {contact.name}
            </h3>
            <p className="label-xs mt-0.5">{contact.role}</p>
          </div>
        </div>

        <span className="flex shrink-0 items-center gap-1 text-xs text-steel-400">
          <IconMap className="h-3.5 w-3.5" />
          {contact.districtName}
        </span>
      </button>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-xs">Tillit</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-white">
            {contact.trust} / 100
          </span>
        </div>
        <div className="mt-1.5">
          <TrustBar trust={contact.trust} label={contact.trustLabel} />
        </div>
        <p
          className={`mt-1.5 text-xs font-semibold ${
            TRUST_TEXT[contact.trustLabel] ?? 'text-steel-400'
          }`}
        >
          {contact.trustLabel}
        </p>
      </div>

      {/* What this person actually has for you. Same data as the mission page. */}
      {missionLine && (
        <p className={`mt-3 text-xs ${missionLine.tone}`}>{missionLine.text}</p>
      )}

      <dl className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
        <div>
          <dt className="label-xs">Status</dt>
          <dd
            className={`mt-0.5 text-sm ${
              contact.canContact ? 'text-neon' : 'text-steel-400'
            }`}
          >
            {contact.statusLabel}
          </dd>
        </div>
        <div className="text-right">
          <dt className="label-xs">Sist kontakt</dt>
          <dd className="mt-0.5 text-sm text-steel-300">
            {contact.lastInteractionAt
              ? formatRelativeTime(contact.lastInteractionAt)
              : 'Aldri'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onContact(contact.id)}
          disabled={!contact.canContact || anyBusy}
          className={`btn flex-1 py-2.5 text-xs ${
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
        <button
          type="button"
          onClick={() => onOpen(contact.id)}
          className="btn-ghost px-4 py-2.5 text-xs"
        >
          Detaljer
          <IconChevron className="h-3.5 w-3.5" />
        </button>
      </div>

      {contact.blockedText && (
        <p className="mt-2 text-center text-xs text-steel-500">{contact.blockedText}</p>
      )}
    </article>
  );
}
