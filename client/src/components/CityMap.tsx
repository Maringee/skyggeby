import type { DistrictStateDto } from '@skyggeby/shared';

interface CityMapProps {
  districts: DistrictStateDto[];
  /** District the card list is currently focused on, if any. */
  selectedId: string | null;
  onSelect: (districtId: string) => void;
}

/** Colour by police presence: the quieter the area, the greener the node. */
function nodeTone(police: number): { fill: string; stroke: string } {
  if (police >= 5) return { fill: 'rgba(232,38,60,0.22)', stroke: '#e8263c' };
  if (police >= 4) return { fill: 'rgba(247,185,85,0.18)', stroke: '#f7b955' };
  if (police >= 3) return { fill: 'rgba(139,92,246,0.18)', stroke: '#8b5cf6' };
  return { fill: 'rgba(61,220,151,0.16)', stroke: '#3ddc97' };
}

/**
 * A schematic of the city. Positions come straight from the district
 * catalogue, so adding a district puts it on the map automatically.
 */
export function CityMap({ districts, selectedId, onSelect }: CityMapProps) {
  const current = districts.find((d) => d.current);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-950/60">
      <svg
        viewBox="0 0 100 84"
        className="h-full w-full"
        role="img"
        aria-label="Kart over Skyggeby"
      >
        <defs>
          <radialGradient id="cityGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(139,92,246,0.16)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <pattern id="cityGrid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M8 0H0V8" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.3" />
          </pattern>
        </defs>

        <rect width="100" height="84" fill="url(#cityGrid)" />
        <rect width="100" height="84" fill="url(#cityGlow)" />

        {/* Roads from the centre outwards */}
        {current &&
          districts
            .filter((d) => !d.current)
            .map((d) => (
              <line
                key={`road-${d.id}`}
                x1={current.position.x}
                y1={current.position.y * 0.84}
                x2={d.position.x}
                y2={d.position.y * 0.84}
                stroke="rgba(255,255,255,0.07)"
                strokeWidth="0.4"
                strokeDasharray="1.5 1.5"
              />
            ))}

        {districts.map((district) => {
          const tone = nodeTone(district.policePresence);
          const x = district.position.x;
          const y = district.position.y * 0.84;
          const selected = selectedId === district.id;

          return (
            <g
              key={district.id}
              onClick={() => onSelect(district.id)}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={district.name}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(district.id);
              }}
            >
              {district.current && (
                <circle cx={x} cy={y} r="7" fill="none" stroke={tone.stroke} strokeWidth="0.4">
                  <animate
                    attributeName="r"
                    values="5;8;5"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.7;0;0.7"
                    dur="3s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              <circle
                cx={x}
                cy={y}
                r={district.current ? 4.2 : 3.4}
                fill={tone.fill}
                stroke={tone.stroke}
                strokeWidth={selected || district.current ? 0.9 : 0.45}
                className="transition-all"
              />

              {district.current && <circle cx={x} cy={y} r="1.4" fill={tone.stroke} />}

              <text
                x={x}
                y={y + 8.2}
                textAnchor="middle"
                fontSize="3.1"
                letterSpacing="0.3"
                fill={district.current ? '#ffffff' : 'rgba(154,161,184,0.9)'}
                className="select-none font-semibold uppercase"
              >
                {district.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
