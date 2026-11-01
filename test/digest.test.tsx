import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { DigestNight } from '../src/digest/types.js';

// Plan morning-digest § 2d. Routes: GET /digest/:night (page) and GET /api/digest/:night (JSON).
// Fixtures are written to a temp runs dir; `runs/` is read-only and never touched.

let runsDir = '';

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

function logLine(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

function writeNight(night: string, lines: string[]): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
}

/** Reads the same night straight from the reader, throwing if the fixture is missing. */
function expectedNight(night: string): DigestNight {
  const result = readNight(runsDir, night);
  if (result === null) throw new Error(`fixture for ${night} was not written to ${runsDir}`);
  return result;
}

async function getPage(night: string): Promise<{ status: number; html: string }> {
  const res = await app().request(`/digest/${night}`);
  return { status: res.status, html: await res.text() };
}

async function getJson(night: string): Promise<{ status: number; body: unknown }> {
  const res = await app().request(`/api/digest/${night}`);
  return { status: res.status, body: await res.json() };
}

/** Narrows an unknown JSON body to an object, with a message that shows what came back. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** The `job` of each entry in a JSON `rows` array. Throws with the offending value otherwise. */
function jobsOf(rows: unknown): string[] {
  if (!Array.isArray(rows)) throw new Error(`expected rows to be an array, got ${JSON.stringify(rows)}`);
  return rows.map((row: unknown) => {
    const job = asRecord(row).job;
    if (typeof job !== 'string') throw new Error(`row has no string job: ${JSON.stringify(row)}`);
    return job;
  });
}

/** The given jobs, ordered by where they first appear in the page. Throws if one is missing. */
function jobsInPageOrder(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => {
      const index = html.indexOf(job);
      if (index === -1) throw new Error(`job "${job}" not found in page`);
      return { job, index };
    })
    .sort((a, b) => a.index - b.index)
    .map(({ job }) => job);
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

// Written out of job order on purpose: the page and the JSON must sort by job.
const BUSY_NIGHT = '2026-10-28';
const BUSY_JOBS_SORTED = ['archive-logs', 'mail-digest', 'nightly-backup'];
const CLEAN_NIGHT = '2026-10-27';
const EMPTY_NIGHT = '2026-10-26';
const MISSING_NIGHT = '2026-10-25';
const BAD_NIGHT = '2026-10-24';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeNight(BUSY_NIGHT, [
    logLine({ at: '2026-10-28T01:00:00+01:00', job: 'mail-digest', status: 'retry', owner: 'ana', error: 'smtp timeout' }),
    logLine({ at: '2026-10-28T01:05:00+01:00', job: 'mail-digest', status: 'retry', owner: 'ana', error: 'smtp timeout' }),
    logLine({ at: '2026-10-28T01:10:00+01:00', job: 'mail-digest', status: 'retry', owner: 'ana', error: 'smtp timeout' }),
    logLine({ at: '2026-10-28T01:15:00+01:00', job: 'mail-digest', status: 'ok', owner: 'ana' }),
    logLine({ at: '2026-10-28T02:00:00+01:00', job: 'nightly-backup', status: 'ok', owner: 'bo' }),
    logLine({ at: '2026-10-28T03:00:00+01:00', job: 'archive-logs', status: 'fail', owner: null, error: 'disk full' }),
  ]);
  writeNight(CLEAN_NIGHT, [
    logLine({ at: '2026-10-27T01:00:00+01:00', job: 'nightly-backup', status: 'ok', owner: 'bo' }),
  ]);
  writeNight(EMPTY_NIGHT, []);
  writeNight(BAD_NIGHT, [
    logLine({ at: '2026-10-24T01:00:00+01:00', job: 'zeta-job', status: 'ok', owner: 'ana' }),
    'this is not json',
    logLine({ at: '2026-10-24T02:00:00+01:00', job: 'alpha-job', status: 'ok', owner: 'bo' }),
  ]);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('404s for a night with no file', async () => {
    const { status } = await getPage(MISSING_NIGHT);
    expect(status).toBe(404);
  });

  it('says "nothing ran" for an empty night', async () => {
    const { status, html } = await getPage(EMPTY_NIGHT);
    expect(status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('mentions the lines that did not parse, and still renders the rows that did', async () => {
    const { status, html } = await getPage(BAD_NIGHT);
    expect(status).toBe(200);
    expect(html).toContain("didn't parse");
    expect(html).toContain('alpha-job');
    expect(html).toContain('zeta-job');
  });

  it('renders one table with the lane banner, rows sorted by job, missing data as —, and warnings marked', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const { status, html } = await getPage(BUSY_NIGHT);
    expect(status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(countOf(html, '<table')).toBe(1);
    expect(jobsInPageOrder(html, ['nightly-backup', 'mail-digest', 'archive-logs'])).toEqual(BUSY_JOBS_SORTED);
    // archive-logs has a null owner, so the page must show — for it.
    expect(html).toContain('—');
    // mail-digest (3 retries) and archive-logs (last status fail) are both flagged.
    expect(countOf(html, 'class="warn"')).toBeGreaterThanOrEqual(2);
  });

  it('marks nothing when no job has 3+ retries or a failed last status', async () => {
    const { html } = await getPage(CLEAN_NIGHT);
    expect(html).not.toContain('class="warn"');
  });
});

describe('GET /api/digest/:night', () => {
  it('404s with an error message for a night with no file', async () => {
    const { status, body } = await getJson(MISSING_NIGHT);
    expect(status).toBe(404);
    expect(typeof asRecord(body).error).toBe('string');
  });

  it('returns rows: [] for an empty night', async () => {
    const { status, body } = await getJson(EMPTY_NIGHT);
    expect(status).toBe(200);
    expect(asRecord(body).rows).toEqual([]);
  });

  it('counts bad lines and still returns the rows that parsed', async () => {
    const { status, body } = await getJson(BAD_NIGHT);
    expect(status).toBe(200);
    expect(asRecord(body).badLines).toBe(1);
    expect(body).toEqual(expectedNight(BAD_NIGHT));
  });

  it('equals readNight() for a busy night', async () => {
    const { status, body } = await getJson(BUSY_NIGHT);
    expect(status).toBe(200);
    expect(body).toEqual(expectedNight(BUSY_NIGHT));
  });
});

describe('page and JSON agree', () => {
  it('lists the same jobs in the same order', async () => {
    const { html } = await getPage(BUSY_NIGHT);
    const { body } = await getJson(BUSY_NIGHT);
    const jsonJobs = jobsOf(asRecord(body).rows);
    expect(jsonJobs).toEqual(BUSY_JOBS_SORTED);
    expect(jobsInPageOrder(html, [...jsonJobs].reverse())).toEqual(jsonJobs);
  });
});
