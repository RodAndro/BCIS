/**
 * HTTP client used by the Electron main process to reach the Fastify API.
 *
 * ── WHY THE MAIN PROCESS MAKES THESE CALLS ──────────────────────────────────
 * The renderer has no network access and no session token. Keeping every API
 * call here means:
 *   - the session token lives in main-process memory, never in the renderer
 *     where a DevTools user could read it out of localStorage;
 *   - the renderer cannot be pointed at an arbitrary host;
 *   - timeouts and error normalisation are applied in exactly one place.
 *
 * ── WHY EVERY CALL HAS A TIMEOUT ────────────────────────────────────────────
 * A cashier's screen must never hang indefinitely on a request that will not
 * return. The timeout turns an unreachable API into a fast, visible error.
 *
 * Phase 2 extends this class with the session token header and a 401 handler
 * that returns the user to the lock screen.
 */

export interface ApiResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T | null;
  readonly error: string | null;
  readonly latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  get base(): string {
    return this.baseUrl;
  }

  async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const startedAt = performance.now();

    try {
      const response = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...init.headers },
        // Node's AbortSignal.timeout aborts with a TimeoutError, which the
        // catch below reports as an unreachable API.
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      const payload = await readJson(response);

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          data: null,
          error: describeFailure(payload, response.status),
          latencyMs,
        };
      }

      return {
        ok: true,
        status: response.status,
        data: payload as T,
        error: null,
        latencyMs,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        data: null,
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? `The API did not respond within ${String(this.timeoutMs)} ms.`
            : 'The API is not reachable.',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A non-JSON body means the API is not the thing answering, which is
    // itself worth reporting rather than crashing on.
    return null;
  }
}

/** Pulls the user-facing message out of the API's error envelope. */
function describeFailure(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const envelope = (payload as { error?: { message?: unknown } }).error;
    if (typeof envelope?.message === 'string') {
      return envelope.message;
    }
  }
  return `The API returned HTTP ${String(status)}.`;
}
