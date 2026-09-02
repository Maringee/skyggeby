import { z } from 'zod';
import {
  ASSET_TYPE_IDS,
  PROPERTY_TUNING,
  PROPERTY_TYPE_IDS,
  VEHICLE_TUNING,
  VEHICLE_TYPE_IDS,
  PLAYER_SEARCH,
  MESSAGE_BOXES,
  MESSAGE_LIMITS,
  BUSINESS_TUNING,
  BUSINESS_TYPE_IDS,
  CONTACT_IDS,
  DISTRICT_IDS,
  LIMITS,
  SKILL_IDS,
} from '@skyggeby/shared';
import { badRequest } from './errors';

/**
 * Zod's built-in messages are English, and they surface whenever a schema does
 * not spell out its own text - most visibly for a field the client simply left
 * out, which produced a bare "Required" in the player's face.
 *
 * Registering a Norwegian error map covers every schema, including ones added
 * later. Messages passed explicitly to a validator still take precedence.
 */
const norwegianErrors: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'Feltet er påkrevd.' };
      }
      if (issue.expected === 'number') {
        return { message: 'Verdien må være et tall.' };
      }
      if (issue.expected === 'string') {
        return { message: 'Verdien må være tekst.' };
      }
      return { message: 'Verdien har feil format.' };

    case z.ZodIssueCode.too_small:
      return { message: 'Verdien er for liten.' };

    case z.ZodIssueCode.too_big:
      return { message: 'Verdien er for stor.' };

    case z.ZodIssueCode.invalid_string:
      return { message: 'Verdien har et ugyldig format.' };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Forespørselen inneholder ukjente felter.' };

    default:
      // Never fall through to ctx.defaultError - that is the English text.
      void ctx;
      return { message: 'Verdien er ugyldig.' };
  }
};

z.setErrorMap(norwegianErrors);

export const usernameSchema = z
  .string({ required_error: 'Brukernavn er påkrevd.' })
  .trim()
  .min(LIMITS.usernameMin, `Brukernavnet må ha minst ${LIMITS.usernameMin} tegn.`)
  .max(LIMITS.usernameMax, `Brukernavnet kan ha maks ${LIMITS.usernameMax} tegn.`)
  .regex(
    /^[a-zA-Z0-9æøåÆØÅ_-]+$/,
    'Brukernavnet kan kun inneholde bokstaver, tall, bindestrek og understrek.',
  );

export const passwordSchema = z
  .string({ required_error: 'Passord er påkrevd.' })
  .min(LIMITS.passwordMin, `Passordet må ha minst ${LIMITS.passwordMin} tegn.`)
  .max(LIMITS.passwordMax, 'Passordet er for langt.');

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string({ required_error: 'Du må gjenta passordet.' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passordene er ikke like.',
  });

export const loginSchema = z.object({
  username: z
    .string({ required_error: 'Brukernavn er påkrevd.' })
    .trim()
    .min(1, 'Brukernavn er påkrevd.'),
  password: z
    .string({ required_error: 'Passord er påkrevd.' })
    .min(1, 'Passord er påkrevd.'),
});

export const amountSchema = z.object({
  amount: z
    .number({
      required_error: 'Du må oppgi et beløp.',
      invalid_type_error: 'Beløpet må være et tall.',
    })
    .int('Beløpet må være et helt tall.')
    .positive('Beløpet må være større enn 0.')
    .max(LIMITS.maxMoney, 'Beløpet er for stort.'),
});

/**
 * Movement input. The district id is checked against the catalogue here, so an
 * unknown id never reaches the service layer.
 */
export const moveSchema = z.object({
  districtId: z
    .string({ required_error: 'Du må velge et distrikt.' })
    .trim()
    .refine((value): value is (typeof DISTRICT_IDS)[number] =>
      (DISTRICT_IDS as readonly string[]).includes(value),
    { message: 'Ukjent distrikt.' }),
});

/**
 * Upgrading a skill. The schema is deliberately just the id: a level, a point
 * total or a bonus in the request body is not described here, so it is dropped
 * before any game code sees it.
 */
export const skillUpgradeSchema = z.object({
  skillId: z
    .string({ required_error: 'Du må velge en ferdighet.' })
    .trim()
    .refine((value): value is (typeof SKILL_IDS)[number] =>
      (SKILL_IDS as readonly string[]).includes(value),
    { message: 'Ukjent ferdighet.' }),
});

/**
 * Buying an asset. Only the type id is described here, so a price, value,
 * condition or location in the request body is dropped before any game code
 * sees it - the server reads all of those from its own catalogue.
 */
export const assetBuySchema = z.object({
  assetTypeId: z
    .string({ required_error: 'Du må velge en eiendel.' })
    .trim()
    .refine((value) => ASSET_TYPE_IDS.includes(value), { message: 'Ukjent eiendel.' }),
});

/** Selling an asset. The id is checked against the owner in the service. */
export const assetSellSchema = z.object({
  assetId: z
    .string({ required_error: 'Du må velge hvilken eiendel du vil selge.' })
    .trim()
    .min(1, 'Du må velge hvilken eiendel du vil selge.')
    .max(64, 'Ugyldig eiendels-id.'),
});

/**
 * Inventory actions. Only the asset id is described, so a slot count, a
 * capacity, a location or a player id in the body is dropped before the service
 * sees it - all of those are the server's to decide.
 */
export const inventoryActionSchema = z.object({
  assetId: z
    .string({ required_error: 'Du må velge hvilken eiendel det gjelder.' })
    .trim()
    .min(1, 'Du må velge hvilken eiendel det gjelder.')
    .max(64, 'Ugyldig eiendels-id.'),
});

/**
 * Naming a contact. Only the id is described, so a trust value, a reliability,
 * a district or a player id in the body never reaches the service - all of
 * those are the server's to decide.
 */
export const contactActionSchema = z.object({
  contactId: z
    .string({ required_error: 'Du må velge hvilken kontakt det gjelder.' })
    .trim()
    .refine((value) => CONTACT_IDS.includes(value), { message: 'Ukjent kontakt.' }),
});

/** Route parameter for a single contact. */
export const contactIdParamSchema = z.object({
  contactId: z
    .string({ required_error: 'Du må oppgi hvilken kontakt du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken kontakt du mener.')
    .max(64, 'Ugyldig kontakt-id.'),
});

/**
 * Buying a business. Only the type and the name are described here, so a price,
 * a district, an income, a balance, a condition, a risk or a player id in the
 * request body is dropped before any game code sees it - the server reads every
 * one of those from its own catalogue.
 */
export const businessBuySchema = z.object({
  businessTypeId: z
    .string({ required_error: 'Du må velge en virksomhet.' })
    .trim()
    .refine((value) => BUSINESS_TYPE_IDS.includes(value), {
      message: 'Ukjent virksomhet.',
    }),
  name: z
    .string({ required_error: 'Du må gi virksomheten et navn.' })
    .trim()
    .min(
      BUSINESS_TUNING.minNameLength,
      `Navnet må ha minst ${BUSINESS_TUNING.minNameLength} tegn.`,
    )
    .max(
      BUSINESS_TUNING.maxNameLength,
      `Navnet kan ha maks ${BUSINESS_TUNING.maxNameLength} tegn.`,
    )
    // Control characters would render as invisible junk in every other
    // player's view of the name later on.
    .regex(new RegExp('^[^\u0000-\u001f\u007f]+$'), 'Navnet inneholder ugyldige tegn.')
    // Stored normalised, so "Rommas   Verksted" and "Rommas Verksted" are the
    // same name rather than two that merely look alike.
    .transform((value) => value.replace(/\s+/g, ' ')),
});

/** Withdrawing from a business. Ownership is checked in the service. */
export const businessWithdrawSchema = z.object({
  businessId: z
    .string({ required_error: 'Du må velge hvilken virksomhet det gjelder.' })
    .trim()
    .min(1, 'Du må velge hvilken virksomhet det gjelder.')
    .max(64, 'Ugyldig virksomhets-id.'),
});

/** Route parameter for a single business. */
export const businessIdParamSchema = z.object({
  businessId: z
    .string({ required_error: 'Du må oppgi hvilken virksomhet du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken virksomhet du mener.')
    .max(64, 'Ugyldig virksomhets-id.'),
});

/**
 * Sending a message. Only these three fields are described, so a `senderId`,
 * a `readAt`, a timestamp or any other field in the request body is dropped
 * before the service sees it - who sent a message is the session's to decide,
 * never the body's.
 *
 * Trimming happens before the length checks, so a subject of nothing but
 * spaces is too short rather than accepted and stored blank.
 */
export const messageSendSchema = z.object({
  recipientId: z
    .string({ required_error: 'Du må velge hvem meldingen skal til.' })
    .trim()
    .min(1, 'Du må velge hvem meldingen skal til.')
    .max(64, 'Ugyldig mottaker.'),
  subject: z
    .string({ required_error: 'Meldingen må ha et emne.' })
    .trim()
    .min(MESSAGE_LIMITS.subjectMin, 'Meldingen må ha et emne.')
    .max(
      MESSAGE_LIMITS.subjectMax,
      `Emnet kan ha maks ${MESSAGE_LIMITS.subjectMax} tegn.`,
    ),
  content: z
    .string({ required_error: 'Meldingen kan ikke være tom.' })
    .trim()
    .min(MESSAGE_LIMITS.contentMin, 'Meldingen kan ikke være tom.')
    .max(
      MESSAGE_LIMITS.contentMax,
      `Meldingen kan ha maks ${MESSAGE_LIMITS.contentMax} tegn.`,
    ),
});

/** Route parameter for a single message. */
export const messageIdParamSchema = z.object({
  messageId: z
    .string({ required_error: 'Du må oppgi hvilken melding du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken melding du mener.')
    .max(64, 'Ugyldig meldings-id.'),
});

/** Paging and box selection for a listing. The server clamps the limit again. */
export const messageListQuerySchema = z.object({
  boks: z
    .enum(MESSAGE_BOXES, { errorMap: () => ({ message: 'Ukjent postkasse.' }) })
    .optional(),
  limit: z.coerce
    .number({ invalid_type_error: 'Grensen må være et tall.' })
    .int('Grensen må være et helt tall.')
    .min(1, 'Grensen må være minst 1.')
    .max(MESSAGE_LIMITS.maxPageSize, `Grensen kan være maks ${MESSAGE_LIMITS.maxPageSize}.`)
    .optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
});

/** Looking up somebody to write to. */
export const messageRecipientQuerySchema = z.object({
  sok: z
    .string({ required_error: 'Skriv et navn å søke etter.' })
    .trim()
    .min(2, 'Skriv minst to tegn for å søke.')
    .max(32, 'Søket er for langt.'),
});

/**
 * Searching for players. Only the term is described, so a limit, an offset or
 * a field selection in the query string is dropped before the service sees it -
 * how many rows come back and which columns they carry is the server's call.
 */
export const playerSearchQuerySchema = z.object({
  sok: z
    .string({ required_error: 'Skriv et navn å søke etter.' })
    .trim()
    .min(PLAYER_SEARCH.minLength, `Skriv minst ${PLAYER_SEARCH.minLength} tegn.`)
    .max(PLAYER_SEARCH.maxLength, 'Søket er for langt.'),
});

/**
 * Route parameter for a public profile.
 *
 * Deliberately permissive on length: a name nobody has should answer "not
 * found" rather than "invalid", so the endpoint says as little as possible
 * about which names exist.
 */
export const usernameParamSchema = z.object({
  username: z
    .string({ required_error: 'Du må oppgi hvilken spiller du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken spiller du mener.')
    .max(64, 'Ugyldig brukernavn.'),
});

/**
 * Buying a vehicle. Only the type and the name are described here, so a price,
 * a district, a condition, an `isActive`, a player id or a cash amount in the
 * body is dropped before any game code sees it.
 */
export const vehicleBuySchema = z.object({
  vehicleTypeId: z
    .string({ required_error: 'Du må velge et kjøretøy.' })
    .trim()
    .refine((value) => VEHICLE_TYPE_IDS.includes(value), { message: 'Ukjent kjøretøy.' }),
  name: z
    .string({ required_error: 'Du må gi kjøretøyet et navn.' })
    .trim()
    .min(
      VEHICLE_TUNING.minNameLength,
      `Navnet må ha minst ${VEHICLE_TUNING.minNameLength} tegn.`,
    )
    .max(
      VEHICLE_TUNING.maxNameLength,
      `Navnet kan ha maks ${VEHICLE_TUNING.maxNameLength} tegn.`,
    )
    .regex(new RegExp('^[^\u0000-\u001f\u007f]+$'), 'Navnet inneholder ugyldige tegn.')
    .transform((value) => value.replace(/\s+/g, ' ')),
});

/** Activating, parking or selling. Ownership is checked in the service. */
export const vehicleActionSchema = z.object({
  vehicleId: z
    .string({ required_error: 'Du må velge hvilket kjøretøy det gjelder.' })
    .trim()
    .min(1, 'Du må velge hvilket kjøretøy det gjelder.')
    .max(64, 'Ugyldig kjøretøy-id.'),
});

/**
 * Driving somewhere. The destination is the only thing the client chooses, and
 * it is checked against the district catalogue here so an unknown id never
 * reaches a row.
 */
export const vehicleMoveSchema = z.object({
  vehicleId: z
    .string({ required_error: 'Du må velge hvilket kjøretøy det gjelder.' })
    .trim()
    .min(1, 'Du må velge hvilket kjøretøy det gjelder.')
    .max(64, 'Ugyldig kjøretøy-id.'),
  destinationDistrictId: z
    .string({ required_error: 'Du må velge hvor kjøretøyet skal.' })
    .trim()
    .refine((value): value is (typeof DISTRICT_IDS)[number] =>
      (DISTRICT_IDS as readonly string[]).includes(value),
    { message: 'Ukjent distrikt.' }),
});

/** Route parameter for a single vehicle. */
export const vehicleIdParamSchema = z.object({
  vehicleId: z
    .string({ required_error: 'Du må oppgi hvilket kjøretøy du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilket kjøretøy du mener.')
    .max(64, 'Ugyldig kjøretøy-id.'),
});

/**
 * Buying a property. Only the type and the name are described here, so a price,
 * a district, a condition, a capacity, a security level, a player id or a cash
 * amount in the request body is dropped before any game code sees it - the
 * server reads every one of those from its own catalogue.
 */
export const propertyBuySchema = z.object({
  propertyTypeId: z
    .string({ required_error: 'Du må velge en eiendom.' })
    .trim()
    .refine((value) => PROPERTY_TYPE_IDS.includes(value), { message: 'Ukjent eiendom.' }),
  name: z
    .string({ required_error: 'Du må gi eiendommen et navn.' })
    .trim()
    .min(
      PROPERTY_TUNING.minNameLength,
      `Navnet må ha minst ${PROPERTY_TUNING.minNameLength} tegn.`,
    )
    .max(
      PROPERTY_TUNING.maxNameLength,
      `Navnet kan ha maks ${PROPERTY_TUNING.maxNameLength} tegn.`,
    )
    .regex(new RegExp('^[^\u0000-\u001f\u007f]+$'), 'Navnet inneholder ugyldige tegn.')
    .transform((value) => value.replace(/\s+/g, ' ')),
});

/** Selling a property. Ownership is checked in the service. */
export const propertyActionSchema = z.object({
  propertyId: z
    .string({ required_error: 'Du må velge hvilken eiendom det gjelder.' })
    .trim()
    .min(1, 'Du må velge hvilken eiendom det gjelder.')
    .max(64, 'Ugyldig eiendoms-id.'),
});

/** Route parameter for a single property. */
export const propertyIdParamSchema = z.object({
  propertyId: z
    .string({ required_error: 'Du må oppgi hvilken eiendom du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken eiendom du mener.')
    .max(64, 'Ugyldig eiendoms-id.'),
});

/** Route parameter for a single piece of information. */
export const informationIdSchema = z.object({
  id: z
    .string({ required_error: 'Du må oppgi hvilken informasjon du mener.' })
    .trim()
    .min(1, 'Du må oppgi hvilken informasjon du mener.')
    .max(64, 'Ugyldig informasjons-id.'),
});

/** Parses input and converts Zod issues into a Norwegian AppError. */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'skjema';
    if (!fields[key]) fields[key] = issue.message;
  }

  const first = Object.values(fields)[0] ?? 'Ugyldige verdier.';
  throw badRequest(first, 'VALIDERINGSFEIL', fields);
}
