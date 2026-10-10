/**
 * Audit addition (Step 21): minimal liveness probe, extracted from main.ts so
 * it can be asserted directly.
 *
 * Deliberately dumb: 200 + `{ "status": "ok" }`. It must never echo env,
 * secrets, database/redis credentials, versions or stack traces, and it must
 * not touch a dependency (a dependency check would turn a liveness probe into
 * an expensive readiness probe and make the container flap when Postgres is
 * briefly busy).
 */
export type HealthResponder = {
  status: (code: number) => { json: (body: unknown) => void };
};

export function healthHandler(_req: unknown, res: HealthResponder): void {
  res.status(200).json({ status: 'ok' });
}
