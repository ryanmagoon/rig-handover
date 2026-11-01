import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus } from './types.js';

type RunLine = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly string[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && STATUSES.includes(value);
}

/** Parses one log line at the edge. Anything that isn't a well-formed run entry is `null`. */
function parseLine(line: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  return error === undefined ? { at, job, status, owner } : { at, job, status, owner, error };
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const body = readFile(join(runsDir, `${night}.jsonl`));
  if (body === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts: DigestNight['counts'] = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const text of body.split('\n')) {
    if (text.trim() === '') continue;
    const line = parseLine(text);
    if (!line) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const isRetry = line.status === 'retry' ? 1 : 0;
    const row = rows.get(line.job);
    if (!row) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: isRetry,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    row.runs += 1;
    row.retries += isRetry;
    if (Date.parse(line.at) < Date.parse(row.firstAt)) row.firstAt = line.at;
    if (Date.parse(line.at) >= Date.parse(row.lastAt)) {
      row.lastAt = line.at;
      row.owner = line.owner;
      row.lastStatus = line.status;
      if (line.error !== undefined) row.lastError = line.error;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows: sorted, badLines, counts };
};
