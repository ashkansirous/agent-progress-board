/** How long an archived item and everything under it is kept before the daily cron removes it for good (Slice 50). */
export const ARCHIVE_KEEP_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Rows the cron purges per statement pair, so one run never passes D1's statement limits. */
export const PURGE_CHUNK_ROWS = 200;

/** Chunks one cron run purges at most; what is left waits for the next run. */
export const PURGE_MAX_CHUNKS = 25;

/** Items archived before this ISO time are purged: `now` less the keep period. */
export function purgeCutoff(now: Date): string {
  return new Date(now.getTime() - ARCHIVE_KEEP_DAYS * MS_PER_DAY).toISOString();
}

/** The note on the history row an archive writes, so the item's history says it was archived and when (Slice 50). */
export const ARCHIVED_NOTE = "archived";
