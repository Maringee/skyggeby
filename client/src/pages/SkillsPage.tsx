import { useCallback, useEffect, useState } from 'react';
import type { SkillDto } from '@skyggeby/shared';
import { ApiError } from '@/api/client';
import { api } from '@/api/endpoints';
import { Alert } from '@/components/Alert';
import { SectionTabs } from '@/components/GataTabs';
import { PageHeader } from '@/components/PageHeader';
import { SkillCard } from '@/components/SkillCard';
import { useAuth } from '@/state/AuthContext';

export function SkillsPage() {
  const { player, setPlayer } = useAuth();
  const [skills, setSkills] = useState<SkillDto[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.skills();
      setSkills(res.skills);
      setPoints(res.skillPoints);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kunne ikke hente ferdighetene dine.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upgrade = async (skillId: string) => {
    if (busyId) return;

    setBusyId(skillId);
    setError(null);
    setMessage(null);

    try {
      // The client names a skill; the server decides everything else.
      const res = await api.upgradeSkill(skillId);
      setSkills(res.skills);
      setPoints(res.skillPoints);
      setPlayer(res.player);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Oppgraderingen feilet. Prøv igjen.');
      void load();
    } finally {
      setBusyId(null);
    }
  };

  if (!player) return null;

  const spent = skills.reduce((sum, skill) => sum + skill.level, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meg"
        title="Ferdigheter"
        intro="Ferdighetspoeng kommer av å gå opp i nivå. Hvor du bruker dem er opp til deg — valget står."
        aside={
          <span
            className={`rounded-lg border px-3 py-2 text-sm ${
              points > 0
                ? 'border-blood-600/45 bg-blood-700/15'
                : 'border-white/[0.08]'
            }`}
          >
            <span className="label-xs mr-2">Poeng</span>
            <span
              className={`font-mono font-semibold ${
                points > 0 ? 'text-blood-400' : 'text-steel-400'
              }`}
            >
              {points}
            </span>
          </span>
        }
      />

      <SectionTabs section="/meg" />

      {points === 0 && !loading && (
        <Alert tone="info">
          Du har ingen ferdighetspoeng tilgjengelig. Gå opp i nivå for å få flere.
        </Alert>
      )}
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <section className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse-soft rounded-xl bg-ink-850/70" />
          ))}
        </section>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            {skills.map((skill, index) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                busy={busyId === skill.id}
                anyBusy={busyId !== null}
                onUpgrade={upgrade}
                delay={index * 45}
              />
            ))}
          </section>

          <p className="text-center text-xs text-steel-500">
            Til sammen {spent} nivåer brukt. Ferdigheter påvirker ikke XP eller
            spillernivået ditt — de er en egen vei.
          </p>
        </>
      )}
    </div>
  );
}
