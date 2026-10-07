import type { PageMeta } from '@bcis/validation';
import type { z } from 'zod';

import { ApiClient } from './api-client';
import { loadApiBaseUrl } from './repo-env';

/**
 * The API surface the main process exposes to its own IPC handlers.
 *
 * ── WHY THIS SITS BETWEEN THE CLIENT AND THE HANDLERS ───────────────────────
 * Two responsibilities that do not belong in a transport:
 *
 *   1. **The session token.** It lives here, in main-process memory, and is
 *      passed to the transport. No handler and no renderer ever sees it.
 *   2. **The response envelope.** Business endpoints answer `{ data, meta }`;
 *      the health probes answer their own shape. Unwrapping that here means
 *      every handler works with the payload it actually cares about.
 */

const client = new ApiClient(loadApiBaseUrl());

let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
  client.setToken(token);
}

export function hasSessionToken(): boolean {
  return sessionToken !== null;
}

export function apiBaseUrl(): string {
  return client.base;
}

interface Envelope {
  readonly data: unknown;
  readonly meta: PageMeta | null;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && 'data' in value && 'meta' in value;
}

export interface ApiFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly errorCode: string | null;
  readonly latencyMs: number;
}

export type ApiOutcome<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly meta: PageMeta | null;
      readonly latencyMs: number;
    }
  | ApiFailure;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

/**
 * Make a request and normalise the result.
 *
 * A 401 is reported as `SESSION_EXPIRED` so every caller treats an expired
 * session the same way, and the token is cleared here rather than in each
 * handler — a stale token that keeps being sent produces a confusing series of
 * failures instead of one clean return to the sign-in screen.
 */
export async function callApi<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<ApiOutcome<T>> {
  const result =
    method === 'GET'
      ? await client.get<unknown>(path)
      : method === 'POST'
        ? await client.post<unknown>(path, body)
        : method === 'PUT'
          ? await client.put<unknown>(path, body)
          : await client.patch<unknown>(path, body);

  if (!result.ok) {
    if (result.status === 401) {
      setSessionToken(null);
    }

    return {
      ok: false,
      status: result.status,
      error: result.error ?? 'The request failed.',
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
    };
  }

  const payload = result.data;
  if (isEnvelope(payload)) {
    return { ok: true, data: payload.data as T, meta: payload.meta, latencyMs: result.latencyMs };
  }

  return { ok: true, data: payload as T, meta: null, latencyMs: result.latencyMs };
}

/**
 * How long a report export may take before it is abandoned.
 *
 * Longer than a normal request because PDF/XLSX generation runs server-side
 * over the full result set, and a large report is not a hang.
 */
const EXPORT_TIMEOUT_MS = 60_000;

/** Fetch an export's raw bytes, normalising failures the same way `callApi` does. */
export async function callApiBytes(
  path: string,
): Promise<{ readonly ok: true; readonly data: Uint8Array } | ApiFailure> {
  const result = await client.getBytes(path, EXPORT_TIMEOUT_MS);

  if (!result.ok) {
    if (result.status === 401) {
      setSessionToken(null);
    }

    return {
      ok: false,
      status: result.status,
      error: result.error ?? 'The request failed.',
      errorCode: result.errorCode,
      latencyMs: result.latencyMs,
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Validate a payload that arrived from the renderer.
 *
 * The renderer is not trusted: `window.bcis.users.create({...})` can be called
 * from DevTools with anything at all. Validating with the same schema the API
 * uses means the main process rejects malformed input before it becomes an HTTP
 * request, and the error is a field-level message rather than a 422 from three
 * layers away.
 */
export function validateInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  const issue = result.error.issues[0];
  const field = issue?.path.join('.') ?? 'input';
  return { ok: false, error: `${field}: ${issue?.message ?? 'is not valid.'}` };
}

/** Build a query string from defined values only. */
export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length === 0 ? '' : `?${query}`;
}
