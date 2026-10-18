import { storage } from '../src/services/storage';
import { apiClient, onSessionExpired, ApiError, isSessionRejection } from '../src/services/api/apiClient';

/**
 * Mobile session renewal (Steps 5-6 of the refresh-token task).
 *
 * The contract under test:
 *  - Access + refresh tokens are both persisted (and both cleared on logout).
 *  - A 401 triggers exactly ONE refresh, shared across concurrent failures
 *    (single-flight), and the original request is retried at most once.
 *  - A rejected refresh clears the session and notifies AuthContext.
 *  - A network failure during refresh does NOT clear a possibly-valid session.
 *  - Payment creation is never blindly retried after an ambiguous failure.
 */

type FetchMock = jest.Mock;

function okResponse(body: unknown, status = 200): any {
  return { ok: status >= 200 && status < 300, status, statusText: '', json: async () => body };
}
function errorResponse(status: number, message = 'err'): any {
  return { ok: false, status, statusText: '', json: async () => ({ message }) };
}

const setFetch = (fn: FetchMock) => {
  (global as any).fetch = fn;
};

beforeEach(async () => {
  await storage.clear();
  setFetch(jest.fn());
});

describe('secure token storage', () => {
  it('stores access and refresh tokens under distinct keys', async () => {
    await storage.setAccessToken('access-1');
    await storage.setRefreshToken('refresh-1');
    expect(await storage.getAccessToken()).toBe('access-1');
    expect(await storage.getRefreshToken()).toBe('refresh-1');
    expect(await storage.getAccessToken()).not.toBe(await storage.getRefreshToken());
  });

  it('clearTokens removes BOTH tokens (used by logout + failed refresh)', async () => {
    await storage.setAccessToken('access-1');
    await storage.setRefreshToken('refresh-1');
    await storage.clearTokens();
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });
});

describe('auto-refresh on 401', () => {
  it('refreshes once and retries the original request exactly once', async () => {
    await storage.setAccessToken('stale-token');
    await storage.setRefreshToken('refresh-1');

    // Call 1: /users/me -> 401. Call 2: /auth/refresh -> new pair. Call 3: retry.
    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401, 'Invalid or expired token'))
        .mockResolvedValueOnce(okResponse({ accessToken: 'new-access', refreshToken: 'new-refresh' }))
        .mockResolvedValueOnce(okResponse({ id: 'u1', name: 'A', email: 'a@b.c' })),
    );

    const me = await apiClient.users.getMe();
    expect(me.id).toBe('u1');

    const calls = (global as any).fetch.mock.calls;
    expect(calls).toHaveLength(3);
    // The retried request carries the NEW access token.
    expect(calls[2][1].headers.Authorization).toBe('Bearer new-access');
    // New refresh token was persisted.
    expect(await storage.getRefreshToken()).toBe('new-refresh');
    expect(await storage.getAccessToken()).toBe('new-access');
  });

  it('does NOT retry when the first attempt succeeds (no refresh call)', async () => {
    await storage.setAccessToken('valid');
    setFetch(jest.fn().mockResolvedValueOnce(okResponse({ id: 'u1' })));

    await apiClient.users.getMe();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('never loops: a second 401 after refresh is surfaced, not retried again', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('refresh-1');

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(okResponse({ accessToken: 'a2', refreshToken: 'r2' }))
        .mockResolvedValueOnce(errorResponse(401)), // retry STILL unauthorized
    );

    await expect(apiClient.users.getMe()).rejects.toThrow(ApiError);
    // 1 original + 1 refresh + 1 retry = 3. A loop would show a 4th.
    expect((global as any).fetch).toHaveBeenCalledTimes(3);
  });
});

describe('single-flight refresh', () => {
  it('concurrent 401s share exactly ONE refresh operation', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('refresh-1');

    let refreshCalls = 0;
    let meHits = 0;
    // One stateful mock: /users/me 401s until the refreshed token arrives;
    // /auth/refresh has artificial latency so the two requests overlap.
    setFetch(
      jest.fn().mockImplementation(async (url: string, init: any) => {
        if (url.includes('/v1/auth/refresh')) {
          refreshCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return okResponse({ accessToken: 'new-a', refreshToken: 'new-r' });
        }
        meHits++;
        // Both pre-refresh calls 401; post-refresh retries succeed.
        const header = init?.headers?.Authorization;
        if (header === 'Bearer new-a') return okResponse({ id: 'u1' });
        return errorResponse(401);
      }),
    );

    const [a, b] = await Promise.all([apiClient.users.getMe(), apiClient.users.getMe()]);

    expect(a.id).toBe('u1');
    expect(b.id).toBe('u1');
    expect(refreshCalls).toBe(1); // the whole point
    expect(meHits).toBe(4); // 2 original 401s + 2 successful retries
  });
});

describe('refresh failure', () => {
  it('a rejected refresh clears the session and notifies AuthContext', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('dead-refresh');
    await storage.setUserSession({ id: 'u1', name: 'A' });

    const seen: string[] = [];
    const unsubscribe = onSessionExpired(() => seen.push('expired'));

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(errorResponse(401, 'Invalid or expired session')), // refresh rejected
    );

    await expect(apiClient.users.getMe()).rejects.toThrow(/Session expired/);

    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
    expect(await storage.getUserSession()).toBeNull();
    expect(seen).toEqual(['expired']);
    unsubscribe();
  });

  it('a NETWORK failure during refresh does not clear a possibly-valid session', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('maybe-good-refresh');

    const seen: string[] = [];
    const unsubscribe = onSessionExpired(() => seen.push('expired'));

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockRejectedValueOnce(new Error('offline')), // refresh unreachable
    );

    await expect(apiClient.users.getMe()).rejects.toThrow(ApiError);

    // Tokens retained — a blip must not log the user out.
    expect(await storage.getRefreshToken()).toBe('maybe-good-refresh');
    expect(seen).toEqual([]);
    unsubscribe();
  });
});

describe('logout', () => {
  it('calls the backend revocation endpoint before clearing local state', async () => {
    await storage.setAccessToken('access-1');
    await storage.setRefreshToken('refresh-1');
    await storage.setUserSession({ id: 'u1', name: 'A' });

    setFetch(jest.fn().mockResolvedValueOnce(okResponse({ success: true })));

    // Drive the same sequence AuthContext.logout performs.
    const refreshToken = await storage.getRefreshToken();
    await apiClient.auth.logout(refreshToken!);
    await storage.clearTokens();
    await storage.removeUserSession();

    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toContain('/v1/auth/logout');
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-1' });
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
    expect(await storage.getUserSession()).toBeNull();
  });

  it('still clears local tokens when the network is unavailable', async () => {
    await storage.setAccessToken('access-1');
    await storage.setRefreshToken('refresh-1');

    setFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const refreshToken = await storage.getRefreshToken();
    // Best-effort server call, then unconditional local cleanup.
    await apiClient.auth.logout(refreshToken!).catch(() => undefined);
    await storage.clearTokens();

    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });
});

describe('payment safety during auth recovery', () => {
  it('replays the SAME idempotency key when a payment is retried after refresh', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('refresh-1');

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(okResponse({ accessToken: 'new-a', refreshToken: 'new-r' }))
        .mockResolvedValueOnce(
          okResponse({ id: 'pay_1', status: 'INITIATED', amountPaise: 15000, upiId: 'c@okaxis' }),
        ),
    );

    await apiClient.payments.create({
      upiId: 'c@okaxis',
      amount: '150.00',
      idempotencyKey: 'idem_key_stable_1',
      categoryId: 'cat-1',
    });

    const calls = (global as any).fetch.mock.calls;
    const originalBody = JSON.parse(calls[0][1].body);
    const retriedBody = JSON.parse(calls[2][1].body);
    // Byte-identical idempotency key => the server dedupes; no double charge.
    expect(retriedBody.idempotencyKey).toBe(originalBody.idempotencyKey);
    expect(retriedBody.idempotencyKey).toBe('idem_key_stable_1');
  });

  it('does NOT retry payment creation after an ambiguous network timeout', async () => {
    await storage.setAccessToken('valid');

    const abortErr: any = new Error('aborted');
    abortErr.name = 'AbortError';
    setFetch(jest.fn().mockRejectedValue(abortErr));

    await expect(
      apiClient.payments.create({
        upiId: 'c@okaxis',
        amount: '150.00',
        idempotencyKey: 'idem_key_timeout',
        categoryId: 'cat-1',
      }),
    ).rejects.toThrow(/timed out/i);

    // A timeout is ambiguous (the write may have committed) — exactly one call.
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });
});

describe('transient refresh failures (server-side, not auth)', () => {
  it('a 500 from /auth/refresh does NOT destroy a possibly-valid session', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('refresh-1');
    await storage.setUserSession({ id: 'u1', name: 'A' });

    const seen: string[] = [];
    const unsubscribe = onSessionExpired(() => seen.push('expired'));

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(errorResponse(500)), // refresh endpoint outage
    );

    // Regression: this used to be collapsed into "Session expired" AND used to
    // clear the local session, logging the user out for a server hiccup while
    // the server-side family stayed alive until its 30-day TTL.
    const err: any = await apiClient.users.getMe().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500); // real status surfaced, not a masked 401

    // Session intact — tokens and cached profile untouched.
    expect(await storage.getRefreshToken()).toBe('refresh-1');
    expect(await storage.getAccessToken()).toBe('stale');
    expect(await storage.getUserSession()).toEqual({ id: 'u1', name: 'A' });
    expect(seen).toEqual([]); // AuthContext was NOT told the session died
    unsubscribe();
  });

  it('a rate-limited (429) refresh also keeps the session', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('refresh-1');

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(errorResponse(429)),
    );

    const err: any = await apiClient.users.getMe().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(await storage.getRefreshToken()).toBe('refresh-1');
  });

  it('a definitive rejection STILL clears the session (the fix is status-scoped)', async () => {
    await storage.setAccessToken('stale');
    await storage.setRefreshToken('dead-refresh');
    await storage.setUserSession({ id: 'u1', name: 'A' });

    setFetch(
      jest
        .fn()
        .mockResolvedValueOnce(errorResponse(401))
        .mockResolvedValueOnce(errorResponse(401)),
    );

    await expect(apiClient.users.getMe()).rejects.toThrow(/Session expired/);
    expect(await storage.getRefreshToken()).toBeNull();
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getUserSession()).toBeNull();
  });

  it('isSessionRejection classifies only 400/401/403 as session death', () => {
    // AuthContext.bootstrapSession branches on exactly this predicate: a false
    // positive wipes a valid persisted session on startup, a false negative
    // leaves a dead session around.
    expect(isSessionRejection(new ApiError(401, 'x'))).toBe(true);
    expect(isSessionRejection(new ApiError(400, 'x'))).toBe(true);
    expect(isSessionRejection(new ApiError(403, 'x'))).toBe(true);

    expect(isSessionRejection(new ApiError(0, 'offline'))).toBe(false);
    expect(isSessionRejection(new ApiError(408, 'timeout'))).toBe(false);
    expect(isSessionRejection(new ApiError(429, 'slow down'))).toBe(false);
    expect(isSessionRejection(new ApiError(500, 'boom'))).toBe(false);
    expect(isSessionRejection(new ApiError(503, 'unavailable'))).toBe(false);
    expect(isSessionRejection(new Error('not an ApiError'))).toBe(false);
    expect(isSessionRejection(undefined)).toBe(false);
  });
});
