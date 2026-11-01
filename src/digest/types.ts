// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job's night, folded from every log line that names it. */
export type DigestRow = {
  job: string;
  /** Owner from the job's last line; `null` is kept, views show it as `—`. */
  owner: string | null;
  /** Lines logged for this job. */
  runs: number;
  /** Lines with status `retry`. */
  retries: number;
  lastStatus: RunStatus;
  /** Most recent `error` seen for this job, or `null` if it never logged one. */
  lastError: string | null;
  /** Earliest and latest `at`, exactly as logged (offset kept, never converted to UTC). */
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  /** One row per job, sorted by job. Empty when the file is empty. */
  rows: DigestRow[];
  /** Lines that didn't parse as a run entry. Counted, never thrown. */
  badLines: number;
  /** Parsed lines per status, for the board's ok / retry / fail counts. */
  counts: Record<RunStatus, number>;
};

/**
 * Reads `<runsDir>/<night>.jsonl`. `night` is `YYYY-MM-DD`.
 * Returns `null` when there is no file for that night (or `night` isn't a date), so routes can 404.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
