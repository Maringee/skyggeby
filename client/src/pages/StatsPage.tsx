import { ComingSoon } from '@/components/ComingSoon';
import { SectionTabs } from '@/components/GataTabs';
import { IconGrid } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';

export function StatsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meg"
        title="Statistikk"
        intro="Tallene bak karrieren din."
      />

      <SectionTabs section="/meg" />

      <ComingSoon
        icon={<IconGrid className="h-6 w-6" />}
        title="Statistikk"
        body="Vi samler allerede tallene, men oversikten er ikke bygget ennå."
        planned={[
          'Jobber utført, lyktes og mislyktes',
          'Utbytte over tid og per distrikt',
          'Hvor treffsikker informasjonen din har vært',
        ]}
      />
    </div>
  );
}
