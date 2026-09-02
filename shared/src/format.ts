/** Norwegian number/currency formatting shared by client and server messages. */

const nbNumber = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });

export const CURRENCY_SYMBOL = 'kr';

export function formatMoney(amount: number): string {
  return `${nbNumber.format(Math.trunc(amount))} ${CURRENCY_SYMBOL}`;
}

export function formatNumber(value: number): string {
  return nbNumber.format(value);
}

export function formatSignedMoney(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${nbNumber.format(Math.abs(Math.trunc(amount)))} ${CURRENCY_SYMBOL}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'nå nettopp';
  if (minutes < 60) return `for ${minutes} min siden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `for ${hours} t siden`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `for ${days} d siden`;
  return formatDateTime(iso);
}

/** Percentage points with a Norwegian decimal comma, e.g. "13,8". */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 }).format(points);
}
