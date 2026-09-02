import { computeBaseValue, type InformationType } from '@skyggeby/shared';
import { resolveDistrict } from '@skyggeby/shared';

/**
 * The server's single measure of what a piece of information is worth.
 *
 * There is no market yet; this exists so a later one has one number to build
 * on, and so nothing else invents its own idea of worth.
 */
export function baseValueFor(
  type: InformationType,
  reliability: number,
  districtId: string | null,
): number {
  const activity = districtId ? resolveDistrict(districtId).activity : null;
  return computeBaseValue({ type, reliability, districtActivity: activity });
}
