/**
 * Application error carrying an HTTP status, a stable machine code and a
 * Norwegian (bokmål) message that is safe to show directly to the player.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (
  message: string,
  code = 'UGYLDIG_FORESPORSEL',
  fields?: Record<string, string>,
) => new AppError(400, code, message, fields);

export const unauthorized = (message = 'Du er ikke logget inn.') =>
  new AppError(401, 'IKKE_AUTENTISERT', message);

export const forbidden = (message = 'Du har ikke tilgang til dette.') =>
  new AppError(403, 'INGEN_TILGANG', message);

export const notFound = (message = 'Fant ikke det du lette etter.') =>
  new AppError(404, 'IKKE_FUNNET', message);

export const conflict = (message: string, code = 'KONFLIKT') =>
  new AppError(409, code, message);

export const tooManyRequests = (message: string) =>
  new AppError(429, 'FOR_MANGE_FORSOK', message);
