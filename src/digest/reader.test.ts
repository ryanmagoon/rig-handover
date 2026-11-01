import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from './reader.js';
import type { DigestNight, DigestRow } from './types.js';

function tempRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

function mustRead(runsDir: string, night: string): DigestNight {
  const result = readNight(runsDir, night);
  if (!result) throw new Error(`expected a night for ${night} in ${runsDir}, got null`);
  return result;
}

function row(night: DigestNight, job: string): DigestRow {
  const found = night.rows.find((r) => r.job === job);
  if (!found) throw new Error(`no row for ${job}; rows: ${night.rows.map((r) => r.job).join(', ')}`);
  return found;
}

describe('readNight', () => {
  it('returns null for a night with no file', () => {
    expect(readNight(tempRuns({}), '2026-10-30')).toBeNull();
  });

  it('returns null for a night that is not a date, so nothing outside runsDir is read', () => {
    const dir = tempRuns({ 'x.jsonl': '' });
    expect(readNight(dir, 'x')).toBeNull();
    expect(readNight(dir, '../runs/2026-10-28')).toBeNull();
  });

  it('reads an empty file as a night where nothing ran', () => {
    const night = mustRead(tempRuns({ '2026-10-30.jsonl': '' }), '2026-10-30');
    expect(night).toEqual({ night: '2026-10-30', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts lines that are not run entries instead of throwing', () => {
    const body = [
      '{"at":"2026-10-30T01:00:00+01:00","job":"a","status":"ok","owner":"rook"}',
      'not json',
      '{"at":"2026-10-30T01:00:00+01:00","job":"b","status":"maybe","owner":"rook"}',
      '{"at":"2026-10-30T01:00:00+01:00","status":"ok","owner":"rook"}',
      '[1,2]',
      '',
    ].join('\n');
    const night = mustRead(tempRuns({ '2026-10-30.jsonl': body }), '2026-10-30');
    expect(night.badLines).toBe(4);
    expect(night.rows.map((r) => r.job)).toEqual(['a']);
  });

  describe('on runs/2026-10-28.jsonl', () => {
    const night = mustRead('runs', '2026-10-28');

    it('has 5 jobs, sorted by job, and 1 bad line', () => {
      expect(night.rows.map((r) => r.job)).toEqual([
        'digest/render',
        'fixtures/refresh',
        'lane/sync',
        'notes/backup',
        'rig/rotate-logs',
      ]);
      expect(night.badLines).toBe(1);
    });

    it('keeps a row whose owner is null', () => {
      expect(row(night, 'digest/render').owner).toBeNull();
    });

    it('folds runs, retries, last status and last error per job', () => {
      expect(row(night, 'fixtures/refresh')).toEqual({
        job: 'fixtures/refresh',
        owner: 'rook',
        runs: 4,
        retries: 3,
        lastStatus: 'ok',
        lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      });
      expect(row(night, 'notes/backup')).toMatchObject({ runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    });

    it('keeps first and last times as logged, offset included', () => {
      expect(row(night, 'lane/sync')).toMatchObject({
        firstAt: '2026-10-28T23:00:06+01:00',
        lastAt: '2026-10-29T05:00:04+01:00',
      });
    });

    it('counts parsed lines per status', () => {
      expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    });
  });
});
