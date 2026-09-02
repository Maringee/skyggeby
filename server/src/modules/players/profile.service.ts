import { PLAYER_SEARCH } from '@skyggeby/shared';
import { prisma } from '../../db/prisma';
import { notFound } from '../../lib/errors';

/**
 * Exactly the columns a public profile is allowed to read.
 *
 * Written as a `select` rather than a filter after the fact: cash, health,
 * heat, skill points and the password hash are never loaded in the first place,
 * so no later change to a serialiser can leak them. The counts come from the
 * database in the same query - the client never says how much anybody owns.
 */
const PUBLIC_SELECT = {
  id: true,
  username: true,
  level: true,
  xp: true,
  reputation: true,
  currentDistrictId: true,
  createdAt: true,
  _count: { select: { businesses: true, assets: true } },
} as const;

export type PublicProfileRow = {
  id: string;
  username: string;
  level: number;
  xp: number;
  reputation: number;
  currentDistrictId: string;
  createdAt: Date;
  _count: { businesses: number; assets: number };
};

/**
 * Looks a player up by name.
 *
 * Matching is on `usernameLower`, which is unique, so "Sjefen", "sjefen" and
 * "SJEFEN" are the same person. A name nobody has answers exactly the way a
 * malformed one does: 404, with nothing said about what does exist.
 */
export async function findPublicProfile(username: string): Promise<PublicProfileRow> {
  const row = await prisma.player.findUnique({
    where: { usernameLower: username.trim().toLowerCase() },
    select: PUBLIC_SELECT,
  });

  if (!row) throw notFound('Fant ikke denne spilleren.');
  return row;
}

/**
 * Escapes the characters LIKE treats as wildcards.
 *
 * Prisma parameterises the value, so SQL injection is not the risk - but it
 * builds a LIKE pattern, and `%` and `_` inside the term would still be
 * wildcards. A player searching for "%" should find the people called "%",
 * which is nobody, rather than a slice of the whole city. PostgreSQL's LIKE
 * uses a backslash as its default escape character.
 */
const LIKE_WILDCARDS = /[\\%_]/g;
const BACKSLASH = String.fromCharCode(92);

function escapeLike(term: string): string {
  return term.replace(LIKE_WILDCARDS, (match) => BACKSLASH + match);
}

/**
 * Finds players by name.
 *
 * The term is matched case-insensitively against `usernameLower` and passed as
 * a parameter, so a search that looks like SQL is just a search that finds
 * nothing. Results are capped and carry the same narrow set of fields a public
 * profile does.
 */
export async function searchPlayers(term: string) {
  const needle = escapeLike(term.trim().toLowerCase());

  return prisma.player.findMany({
    where: { usernameLower: { contains: needle } },
    select: {
      id: true,
      username: true,
      level: true,
      reputation: true,
      currentDistrictId: true,
    },
    orderBy: [{ level: 'desc' }, { usernameLower: 'asc' }],
    take: PLAYER_SEARCH.maxResults,
  });
}

export type PlayerSearchRow = Awaited<ReturnType<typeof searchPlayers>>[number];
