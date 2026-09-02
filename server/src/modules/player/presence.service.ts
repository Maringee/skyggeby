import { prisma } from '../../db/prisma';

/** How stale `lastSeenAt` is allowed to get before we write it again. */
const PRESENCE_WRITE_INTERVAL_MS = 60_000;

/** Guard against unbounded growth if a lot of accounts are active. */
const MAX_TRACKED_PLAYERS = 50_000;

const lastWrittenAt = new Map<string, number>();

/**
 * Records that a player is online, at most once a minute per player.
 *
 * Writing on every authenticated request meant an unlocked `UPDATE players`
 * behind each call. Those updates queue behind the row lock held by whatever
 * crime or bank transaction is in flight, so a burst of requests from one
 * player could tie up connections and starve the actual game actions.
 *
 * Presence does not need to be precise, so throttling removes the contention
 * without changing anything the player can observe.
 */
export function touchPresence(playerId: string): void {
  const now = Date.now();
  const previous = lastWrittenAt.get(playerId);

  if (previous !== undefined && now - previous < PRESENCE_WRITE_INTERVAL_MS) {
    return;
  }

  if (lastWrittenAt.size >= MAX_TRACKED_PLAYERS) {
    const oldest = lastWrittenAt.keys().next();
    if (!oldest.done) lastWrittenAt.delete(oldest.value);
  }

  lastWrittenAt.set(playerId, now);

  // Fire-and-forget: presence must never delay or fail a request.
  void prisma.player
    .update({ where: { id: playerId }, data: { lastSeenAt: new Date(now) } })
    .catch(() => {
      // Allow a retry on the next request if the write did not land.
      lastWrittenAt.delete(playerId);
    });
}
