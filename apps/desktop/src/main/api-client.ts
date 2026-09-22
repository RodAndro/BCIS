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
 * ── THE TOKEN ───────────────────────────────────────────────────────────────
 * `setToken` is the only way the credential enters the client. It is held in a
 * private field on this instance — which lives in the main process — and is
 * attached as a bearer header on every request. It is never returned to the
 * renderer by any code path in this file.
 */

export interface ApiResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T | null;
  /** Human-readable message from the API error envelope, or a transport message. */
  readonly error: string | null;
  /** Machine-readable code from the API error envelope, e.g. `FORBIDDEN`. */
  readonly errorCode: string | null;
  readonly latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class ApiClient {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  get base(): string {
    return this.baseUrl;
  }

  /** Attach (or clear) the session token used for authenticated requests. */
  setToken(token: string | null): void {
    this.token = token;
  }

  async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async put<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  async patch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const startedAt = performance.now();

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(this.token === null ? {} : { authorization: `Bearer ${this.token}` }),
    };

    try {
      const response = await fetch(url, {
        ...init,
        headers,
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
          errorCode: readErrorCode(payload),
          latencyMs,
        };
      }

      return {
        ok: true,
        status: response.status,
        data: payload as T,
        error: null,
        errorCode: null,
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
        errorCode: 'API_UNREACHABLE',
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

/** Pulls the machine-readable code out of the API's error envelope. */
function readErrorCode(payload: unknown): string | null {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const envelope = (payload as { error?: { code?: unknown } }).error;
    if (typeof envelope?.code === 'string') {
      return envelope.code;
    }
  }
  return null;
}
