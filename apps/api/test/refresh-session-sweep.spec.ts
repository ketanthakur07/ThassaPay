import {
  RefreshSessionSweepJob,
  deleteDeadFamilySessions,
  sweepCutoff,
  DEAD_SESSION_RETENTION_MS,
  SWEEP_BATCH_SIZE,
  MAX_BATCHES_PER_RUN,
} from '../src/auth/refresh-session-sweep.job';

/**
 * Expired-session cleanup (the sweep the schema's `@@index([expiresAt])`
 * comment always promised but nothing implemented).
 *
 * Two layers of coverage:
 *  1. SQL SHAPE — the tagged-template statement is pinned: it must stay
 *     family-scoped (NOT EXISTS a live row in the same familyId). A row-scoped
 *     `expiresAt < now` delete is the tempting "simplification" that would
 *     silently break reuse detection, so the invariant is asserted directly.
 *  2. RULE SEMANTICS — an in-memory model of the delete predicate proves the
 *     security-critical cases (consumed-but-unexpired rows keep their family
 *     alive, grace period honoured, live tokens never deleted). The exact SQL
 *     is additionally run against a real Postgres in live verification; this
 *     suite proves the rule it must implement.
 */

function mockClient(executeRawImpl?: (...args: unknown[]) => Promise<number>) {
  const calls: { strings: unknown; values: unknown[] }[] = [];
  const $executeRaw = (strings: unknown, ...values: unknown[]) => {
    calls.push({ strings, values });
    return executeRawImpl ? executeRawImpl(strings, ...values) : Promise.resolve(0);
  };
  return { client: { $executeRaw } as any, calls };
}

describe('sweepCutoff', () => {
  it('is the retention grace behind "now"', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    expect(sweepCutoff(now).getTime()).toBe(now.getTime() - DEAD_SESSION_RETENTION_MS);
    expect(DEAD_SESSION_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('deleteDeadFamilySessions SQL shape', () => {
  it('is family-scoped: deletes only when NO row in the family is still live', async () => {
    const { client, calls } = mockClient();
    const cutoff = new Date();

    await deleteDeadFamilySessions(client, cutoff, 100);

    expect(calls).toHaveLength(1);
    const sql = (calls[0].strings as string[]).join('?');
    // The security invariant. These three assertions exist to make the
    // security-weakening "simplification" fail loudly in review:
    //   DELETE ... WHERE expiresAt < now  (row-scoped) would drop all three.
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('live."familyId" = s."familyId"');
    expect(sql).toContain('live."expiresAt" >=');
    // And it must NOT contain a bare row-scoped expiry predicate.
    expect(sql).not.toMatch(/DELETE FROM "refresh_sessions"\s+WHERE "expiresAt"/);
  });

  it('binds the cutoff and batch size as parameters (no string interpolation)', async () => {
    const { client, calls } = mockClient();
    const cutoff = new Date('2026-10-12T00:00:00Z');

    await deleteDeadFamilySessions(client, cutoff, 250);

    expect(calls[0].values).toEqual([cutoff, 250]);
  });

  it('does not filter candidates on consumedAt/revokedAt', async () => {
    const { client, calls } = mockClient();
    await deleteDeadFamilySessions(client, new Date(), 10);
    const sql = (calls[0].strings as string[]).join('?');
    // A consumed-but-unexpired row must keep its family alive for reuse
    // detection — so the candidate scan may not exclude consumed rows.
    expect(sql).not.toContain('consumedAt');
    expect(sql).not.toContain('revokedAt');
  });
});

describe('RefreshSessionSweepJob.sweep batching', () => {
  it('returns 0 and touches nothing when the backlog is empty', async () => {
    const { client, calls } = mockClient(() => Promise.resolve(0));
    const job = new RefreshSessionSweepJob(client);

    await expect(job.sweep()).resolves.toBe(0);
    expect(calls).toHaveLength(1); // one statement, then stop
  });

  it('keeps deleting until a batch comes back short (backlog drained)', async () => {
    const counts = [SWEEP_BATCH_SIZE, SWEEP_BATCH_SIZE, 42];
    const { client, calls } = mockClient(() => Promise.resolve(counts.shift() ?? 0));
    const job = new RefreshSessionSweepJob(client);

    await expect(job.sweep()).resolves.toBe(2 * SWEEP_BATCH_SIZE + 42);
    expect(calls).toHaveLength(3);
  });

  it('caps a huge backlog at MAX_BATCHES_PER_RUN per daily run', async () => {
    const { client, calls } = mockClient(() => Promise.resolve(SWEEP_BATCH_SIZE));
    const job = new RefreshSessionSweepJob(client);

    const total = await job.sweep();

    expect(calls).toHaveLength(MAX_BATCHES_PER_RUN);
    expect(total).toBe(MAX_BATCHES_PER_RUN * SWEEP_BATCH_SIZE);
  });

  it('uses the retention cutoff, not "now", on every batch', async () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const { client, calls } = mockClient(() => Promise.resolve(0));
    const job = new RefreshSessionSweepJob(client);

    await job.sweep(now);

    expect(calls[0].values[0]).toEqual(sweepCutoff(now));
  });
});

// ---------------------------------------------------------------------------
// Rule semantics: a faithful model of the DELETE's predicate.
// ---------------------------------------------------------------------------

type Row = { id: string; familyId: string; expiresAt: Date };

/** Mirrors: DELETE s WHERE NOT EXISTS (live row in same family with expiresAt >= cutoff).
 *  A row survives iff some row in its family (possibly itself) has
 *  expiresAt >= cutoff — i.e. only fully-expired-past-grace families die. */
function applyDeleteRule(rows: Row[], cutoff: Date): Row[] {
  return rows.filter((s) =>
    rows.some((live) => live.familyId === s.familyId && live.expiresAt >= cutoff),
  );
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T00:00:00Z');
const CUTOFF = sweepCutoff(NOW);

function row(id: string, familyId: string, expiresInDays: number): Row {
  return { id, familyId, expiresAt: new Date(NOW.getTime() + expiresInDays * DAY) };
}

describe('delete rule semantics (family-scoped)', () => {
  it('keeps a consumed-but-unexpired row so reuse detection can still fire', () => {
    // t1 was rotated (consumed) but its family's t2 is live for 20 more days.
    // t1 is not redeemable — yet replaying it must burn the family, so its row
    // has to survive. This is the case a row-scoped sweep would get wrong.
    const rows = [row('t1', 'fam-a', 10), row('t2', 'fam-a', 20)];
    expect(applyDeleteRule(rows, CUTOFF)).toHaveLength(2);
  });

  it('keeps every row of a family with any redeemable token', () => {
    const rows = [
      row('t1', 'fam-a', 1), // unexpired
      row('t2', 'fam-a', 30),
      row('x1', 'fam-b', 5), // different family, also alive
    ];
    expect(applyDeleteRule(rows, CUTOFF)).toHaveLength(3);
  });

  it('keeps rows still inside the forensic retention grace', () => {
    // Expired 2 days ago: past TTL, but within the 7-day grace — kept for
    // incident forensics. (Redemption is unaffected: rotate() rejects expired
    // tokens regardless of row existence.)
    const rows = [row('old', 'fam-a', -2)];
    expect(applyDeleteRule(rows, CUTOFF)).toHaveLength(1);
  });

  it('deletes every row of a fully-expired family (past grace)', () => {
    const rows = [row('t1', 'fam-a', -10), row('t2', 'fam-a', -8), row('live', 'fam-b', 3)];
    const survivors = applyDeleteRule(rows, CUTOFF);

    expect(survivors.map((r) => r.id)).toEqual(['live']); // fam-a gone entirely
  });

  it('never deletes a live token', () => {
    const rows = [row('t1', 'fam-a', 0.001), row('t2', 'fam-a', -30)];
    expect(applyDeleteRule(rows, CUTOFF).some((r) => r.id === 't1')).toBe(true);
  });

  it('is idempotent: a second run over the survivors changes nothing', () => {
    const rows = [row('t1', 'fam-a', -30), row('t2', 'fam-a', -9), row('live', 'fam-b', 4)];
    const once = applyDeleteRule(rows, CUTOFF);
    const twice = applyDeleteRule(once, CUTOFF);

    expect(once).toEqual(twice);
    expect(twice.map((r) => r.id)).toEqual(['live']);
  });

  it('a family whose newest token sits exactly at the cutoff is retained', () => {
    const edge: Row = { id: 'edge', familyId: 'fam-a', expiresAt: CUTOFF };
    expect(applyDeleteRule([edge], CUTOFF)).toHaveLength(1);
  });
});
