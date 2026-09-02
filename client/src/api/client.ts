import type { ApiErrorBody } from '@skyggeby/shared';

const BASE_URL = '/api';

/** Error thrown for every non-2xx API response. `message` is always Norwegian. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETTVERKSFEIL',
      'Fikk ikke kontakt med serveren. Sjekk tilkoblingen din.',
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  let payload: unknown = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UKJENT_FEIL',
      body?.error?.message ?? 'Noe gikk galt. Prøv igjen.',
      body?.error?.fields ?? {},
    );
  }

  return payload as T;
}
