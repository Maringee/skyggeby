import { useCallback, useEffect, useState } from 'react';
import { resolveDistrict } from '@skyggeby/shared';
import type { ContactDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { ContactCard } from '@/components/ContactCard';
import { ContactDetail } from '@/components/ContactDetail';
import { SectionTabs } from '@/components/GataTabs';
import { IconSearch, IconUser } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/state/AuthContext';

export function ContactsPage() {
  const { player } = useAuth();

  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.contacts();
      setContacts(res.contacts);
      setTotal(res.totalKnown);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente kontaktene dine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const discover = async () => {
    if (discovering) return;

    setDiscovering(true);
    setError(null);
    setMessage(null);

    try {
      // The client sends nothing; who turns up is the server's call.
      const res = await api.discoverContact();
      setContacts(res.contacts);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Letingen mislyktes. Prøv igjen.');
      void load();
    } finally {
      setDiscovering(false);
    }
  };

  const contact = async (contactId: string) => {
    if (busyId) return;

    setBusyId(contactId);
    setError(null);
    setMessage(null);

    try {
      const res = await api.contactPerson(contactId);
      setContacts(res.contacts);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kontakten mislyktes. Prøv igjen.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  if (!player) return null;

  const district = resolveDistrict(player.currentDistrictId);
  const open = contacts.find((c) => c.id === openId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meg"
        title="Kontakter"
        intro="Ditt nettverk. Folk du kjenner, og hvor godt de kjenner deg."
        aside={
          <span className="rounded-lg border border-white/[0.08] px-3 py-2 text-sm">
            <span className="label-xs mr-2">Kjenner</span>
            <span className="font-mono font-semibold text-white">
              {contacts.length} / {total}
            </span>
          </span>
        }
      />

      <SectionTabs section="/meg" />

      {/* Discovery */}
      <section className="panel panel-edge animate-fade-up p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg tracking-[0.16em] text-white">
              UTFORSK ETTER KONTAKTER
            </h2>
            <p className="mt-1 text-xs text-steel-500">
              Du leter der du står:{' '}
              <span className="font-semibold text-violet-400">{district.name}</span>. Folk
              herfra dukker opp først.
            </p>
          </div>

          <div className="w-full shrink-0 sm:w-auto">
            <button
              type="button"
              onClick={discover}
              disabled={discovering || contacts.length >= total}
              className="btn-primary w-full sm:w-56"
            >
              {discovering ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Leter ...
                </>
              ) : (
                <>
                  <IconSearch className="h-4 w-4" />
                  Utforsk etter kontakter
                </>
              )}
            </button>
            {contacts.length >= total && total > 0 && (
              <p className="mt-2 text-center text-xs text-steel-500 sm:text-right">
                Du kjenner alle i byen.
              </p>
            )}
          </div>
        </div>

        {message && (
          <div className="mt-5">
            <Alert tone="success">{message}</Alert>
          </div>
        )}
        {error && (
          <div className="mt-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </section>

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : contacts.length === 0 ? (
        <section className="panel panel-edge animate-fade-up p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-violet-600/30 bg-violet-700/10 text-violet-400">
            <IconUser className="h-6 w-6" />
          </div>
          <p className="font-display text-xl tracking-[0.14em] text-white">
            DU KJENNER INGEN ENNÅ
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-steel-400">
            Utforsk området for å bli kjent med folk.
          </p>
        </section>
      ) : (
        <>
          <p className="text-sm text-steel-400">
            Du kjenner {contacts.length}{' '}
            {contacts.length === 1 ? 'person' : 'personer'}.
          </p>
          <section className="grid gap-4 md:grid-cols-2">
            {contacts.map((item, index) => (
              <ContactCard
                key={item.id}
                contact={item}
                busy={busyId === item.id}
                anyBusy={busyId !== null}
                onContact={contact}
                onOpen={setOpenId}
                delay={index * 45}
              />
            ))}
          </section>
        </>
      )}

      {open && (
        <ContactDetail
          contact={open}
          busy={busyId === open.id}
          onContact={contact}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
