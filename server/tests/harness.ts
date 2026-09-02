/**
 * Shared plumbing for the integration tests.
 *
 * These tests run against the real PostgreSQL database configured in
 * `server/.env`. Nothing is mocked: the point is to prove that the row locks
 * and transaction isolation behave under genuine concurrency.
 *
 * Every test creates its own players with a unique prefix and removes them
 * afterwards, so the suite is safe to run against a development database.
 */
import type { Information, Player, Prisma } from '@prisma/client';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  SKILLS,
  xpRequiredForLevel,
} from '@skyggeby/shared';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { prisma } from '../src/db/prisma';

/**
 * Reserved namespace for test accounts. Real players cannot register a name
 * starting with this, because usernames created through the API never begin
 * with `qa_` followed by a base36 timestamp - and even if one did, the suite
 * only ever touches rows it created in this run plus stale `qa_` leftovers.
 */
export const TEST_NAMESPACE = 'qa_';

/** Marks every row this suite creates, so cleanup can be exact. */
export const TEST_PREFIX = `${TEST_NAMESPACE}${Date.now().toString(36)}`;

let counter = 0;

export interface TestPlayer {
  player: Player;
  token: string;
  cookie: string;
}

export async function createTestPlayer(overrides: Partial<Player> = {}): Promise<TestPlayer> {
  // Captured before the first await: two fixtures created in parallel would
  // otherwise read the counter after each other's increments and collide on
  // the session token.
  const n = (counter += 1);
  const username = `${TEST_PREFIX}_${n}`;

  const player = await prisma.player.create({
    data: {
      username,
      usernameLower: username.toLowerCase(),
      // Not a usable login; these tests drive the session directly.
      passwordHash: 'x',
      ...overrides,
    },
  });

  // Registration gives every player all six skills; fixtures must match.
  await prisma.playerSkill.createMany({
    data: SKILLS.map((skill) => ({ playerId: player.id, skillId: skill.id, level: 0 })),
    skipDuplicates: true,
  });

  const token = `${TEST_PREFIX}_token_${n}`;
  await prisma.session.create({
    data: {
      token,
      playerId: player.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return { player, token, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

/**
 * Level always follows from total XP - the game recomputes it on every XP
 * grant. A fixture that sets a level without the matching XP is an impossible
 * player, and the first crime would silently demote them.
 */
export function atLevel(level: number): { level: number; xp: number } {
  return { level, xp: xpRequiredForLevel(level) };
}

/**
 * Writes a piece of information directly, bypassing the generator.
 *
 * Discovery is random by design, so tests that need a specific reliability,
 * age or truth value seed the row themselves and then exercise the real code
 * paths against it.
 */
export async function createInformation(
  ownerId: string,
  overrides: Partial<Prisma.InformationUncheckedCreateInput> = {},
): Promise<Information> {
  return prisma.information.create({
    data: {
      ownerId,
      type: 'ETTERRETNING',
      source: 'ETTERFORSKNING',
      relevance: 'SIKKERHET',
      title: 'Testinformasjon',
      content: 'Innhold brukt i testene.',
      districtId: 'sentrum',
      reliability: 90,
      isTrue: true,
      baseValue: 500,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      ...overrides,
    },
  });
}

export async function reloadInformation(id: string): Promise<Information> {
  return prisma.information.findUniqueOrThrow({ where: { id } });
}

export async function reload(playerId: string): Promise<Player> {
  return prisma.player.findUniqueOrThrow({ where: { id: playerId } });
}

export async function cleanup(): Promise<void> {
  // Sessions, transactions and crime attempts cascade from the player.
  await prisma.player.deleteMany({
    where: { username: { startsWith: TEST_PREFIX } },
  });
}

/**
 * Removes leftovers from a previous run that was killed before its cleanup
 * could run. Without this the consistency checks would inspect rows this run
 * never created.
 */
export async function purgeStaleTestData(): Promise<number> {
  const result = await prisma.player.deleteMany({
    where: { username: { startsWith: TEST_NAMESPACE } },
  });
  return result.count;
}

export interface TestServer {
  base: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const app = createApp();
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    base: `http://127.0.0.1:${port}/api`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

export function section(title: string): void {
  console.log('');
  console.log(`== ${title} ==`);
}

export function note(text: string): void {
  console.log(`       ${text}`);
}

export function summary(): number {
  console.log('');
  console.log('----');
  console.log(`${passed} ok, ${failed} feil`);
  if (failures.length > 0) {
    console.log(`Feilet: ${failures.join(', ')}`);
  }
  return failed;
}

/** Runs the same request N times truly in parallel. */
export function burst<T>(times: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: times }, (_, i) => fn(i)));
}

export interface JsonResponse {
  status: number;
  body: any;
}

export async function post(
  base: string,
  path: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export async function get(
  base: string,
  path: string,
  options: { cookie?: string } = {},
): Promise<JsonResponse> {
  const res = await fetch(`${base}${path}`, {
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
