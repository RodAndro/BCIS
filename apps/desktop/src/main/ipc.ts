import {
  applyPenaltiesSchema,
  applyPlanRateSchema,
  auditListQuerySchema,
  batchReconciliationSchema,
  batchRemittanceSchema,
  changePasswordSchema,
  changePlanPriceSchema,
  changeServiceAccountPlanSchema,
  closeCollectionBatchSchema,
  collectionBatchListQuerySchema,
  collectorAssignmentSchema,
  createAdjustmentSchema,
  createCollectionAreaSchema,
  createCollectionBatchSchema,
  createPaymentSchema,
  createPlanSchema,
  createServiceAccountSchema,
  createSubscriberSchema,
  createUserSchema,
  finalizeInvoiceSchema,
  generateBillingSchema,
  invoiceListQuerySchema,
  ledgerQuerySchema,
  loginSchema,
  paymentListQuerySchema,
  planListQuerySchema,
  receivableListQuerySchema,
  replaceAddressesSchema,
  replaceContactsSchema,
  reportExportSchema,
  reportQuerySchema,
  retirePlanSchema,
  reversePaymentSchema,
  serviceAccountListQuerySchema,
  setRolePermissionsSchema,
  setServiceAccountStatusSchema,
  setSubscriberStatusSchema,
  setUserStatusSchema,
  submitCollectionBatchSchema,
  subscriberListQuerySchema,
  subscriberSearchQuerySchema,
  updatePlanSchema,
  updateServiceAccountSchema,
  updateSettingSchema,
  updateSubscriberSchema,
  updateUserSchema,
  userListQuerySchema,
  verifyPaymentSchema,
  voidInvoiceSchema,
} from '@bcis/validation';
import type { LoginResult, SessionUser } from '@bcis/validation';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  type AppInfo,
  type AuthResult,
  type AuthState,
  type HealthCheckResult,
  IPC_CHANNELS,
  type ItemResult,
  type ListResult,
  type ReportExportResult,
} from '@shared/ipc';

import {
  apiBaseUrl,
  callApi,
  callApiBytes,
  hasSessionToken,
  setSessionToken,
  toQueryString,
  validateInput,
} from './api';

/**
 * IPC handlers.
 *
 * ── EVERY PAYLOAD IS VALIDATED ──────────────────────────────────────────────
 * The renderer can call any of these functions from DevTools with any argument,
 * so each handler validates with the same Zod schema the API uses. A malformed
 * payload is rejected here, before it becomes an HTTP request.
 *
 * ── THE TOKEN IS NEVER RETURNED ─────────────────────────────────────────────
 * `auth:login` receives the token from the API and stores it in main-process
 * memory. The value returned to the renderer is an `AuthState` — who is signed
 * in, whether the session is locked — and contains no credential.
 */

const ANONYMOUS: AuthState = { authenticated: false, locked: false, user: null };

function ok<T>(item: T): ItemResult<T> {
  return { ok: true, item, error: null, errorCode: null };
}

function itemFailure<T>(error: string, errorCode: string | null): ItemResult<T> {
  return { ok: false, item: null, error, errorCode };
}

function listFailure<T>(error: string, errorCode: string | null): ListResult<T> {
  return { ok: false, items: [], total: 0, error, errorCode };
}

/** Reject a malformed payload with the same shape as an API failure. */
function rejected<T>(error: string): ItemResult<T> {
  return itemFailure<T>(error, 'VALIDATION_FAILED');
}

function exportFailure(error: string, errorCode: string | null): ReportExportResult {
  return { ok: false, filePath: null, error, errorCode };
}

/** A payload that carries an id and nothing else. */
const idOnlySchema = z.object({ id: z.number().int().positive() });

/** A payload that carries an id and a validated body. */
function withBody<T extends z.ZodType>(body: T) {
  return z.object({ id: z.number().int().positive(), input: body });
}

/**
 * Normalise a plan-list query for the shared schema.
 *
 * `planListQuerySchema` is written for a QUERY STRING, where `currentOnly`
 * arrives as the literal text `"true"`/`"false"`. The renderer sends a real
 * boolean. Converting here lets one schema serve both callers rather than
 * maintaining a second, subtly different one for IPC.
 */
function normalisePlanQuery(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return {};

  const record = payload as Record<string, unknown>;
  const currentOnly = record['currentOnly'];

  return {
    ...record,
    ...(typeof currentOnly === 'boolean' ? { currentOnly: currentOnly ? 'true' : 'false' } : {}),
  };
}

/** Local schemas for the shapes that wrap a validated body with an identifier. */
const userIdInputSchema = z.object({ id: z.number().int().positive() });
const updateUserInputSchema = z.object({
  id: z.number().int().positive(),
  input: updateUserSchema,
});
const setUserStatusInputSchema = z.object({
  id: z.number().int().positive(),
  input: setUserStatusSchema,
});
const rolePermissionsInputSchema = z.object({
  code: z.string().trim().min(1).max(60),
  input: setRolePermissionsSchema,
});
const settingUpdateInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: updateSettingSchema.shape.value,
});
const unlockInputSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Read the current session state.
 *
 * Called after every auth mutation rather than assembled from the mutation's
 * own response, so there is one definition of "what state is the session in"
 * and it always comes from the server.
 */
async function loadAuthState(): Promise<{
  readonly state: AuthState;
  readonly ok: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
}> {
  if (!hasSessionToken()) {
    return { state: ANONYMOUS, ok: true, error: null, errorCode: null };
  }

  const outcome = await callApi<{
    authenticated: boolean;
    locked: boolean;
    user: SessionUser | null;
  }>('GET', '/auth/me');

  if (!outcome.ok) {
    // `callApi` clears the token on a 401, so an expired session simply reads
    // as signed out rather than as an error the cashier has to interpret.
    if (outcome.status === 401) {
      return { state: ANONYMOUS, ok: true, error: null, errorCode: null };
    }
    return { state: ANONYMOUS, ok: false, error: outcome.error, errorCode: outcome.errorCode };
  }

  return {
    state: {
      authenticated: outcome.data.authenticated,
      locked: outcome.data.locked,
      user: outcome.data.user,
    },
    ok: true,
    error: null,
    errorCode: null,
  };
}

/** Build an AuthResult from the server's current view of the session. */
async function authResult(
  error: string | null = null,
  errorCode: string | null = null,
): Promise<AuthResult> {
  const loaded = await loadAuthState();
  return {
    ok: error === null && loaded.ok,
    error: error ?? loaded.error,
    errorCode: errorCode ?? loaded.errorCode,
    state: loaded.state,
  };
}

export function registerIpcHandlers(): void {
  // ── Health and application info ──────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.HEALTH_CHECK, async (): Promise<HealthCheckResult> => {
    const apiResult = await callApi<{ status: string; version: string }>('GET', '/health');

    // The API is up but the database question is separate, so ask it too. A
    // single combined call would let a live API with a dead database look
    // healthy, which is the failure mode this whole panel exists to catch.
    const databaseResult = await callApi<{
      status: 'ok' | 'degraded' | 'unavailable';
      database: {
        connected: boolean;
        latencyMs: number;
        serverVersion: string | null;
        appliedMigrations: number | null;
        pendingMigrations: string[];
      };
    }>('GET', '/health/db');

    return {
      ok: apiResult.ok && databaseResult.ok,
      api: {
        reachable: apiResult.ok,
        baseUrl: apiBaseUrl(),
        status: apiResult.ok ? apiResult.data.status : null,
        version: apiResult.ok ? apiResult.data.version : null,
        latencyMs: apiResult.latencyMs,
        error: apiResult.ok ? null : apiResult.error,
      },
      database: databaseResult.ok
        ? {
            connected: databaseResult.data.database.connected,
            status: databaseResult.data.status,
            latencyMs: databaseResult.data.database.latencyMs,
            serverVersion: databaseResult.data.database.serverVersion,
            appliedMigrations: databaseResult.data.database.appliedMigrations,
            pendingMigrations: databaseResult.data.database.pendingMigrations,
            error: null,
          }
        : {
            connected: false,
            status: null,
            latencyMs: null,
            serverVersion: null,
            appliedMigrations: null,
            pendingMigrations: [],
            error: databaseResult.error,
          },
      checkedAt: new Date().toISOString(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_INFO, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node,
      platform: process.platform,
      apiBaseUrl: apiBaseUrl(),
    };
  });

  // ── Authentication ───────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, payload): Promise<AuthResult> => {
    const parsed = validateInput(loginSchema, payload);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, errorCode: 'VALIDATION_FAILED', state: ANONYMOUS };
    }

    const outcome = await callApi<LoginResult>('POST', '/auth/login', parsed.value);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error, errorCode: outcome.errorCode, state: ANONYMOUS };
    }

    // The token is stored here and never returned to the renderer.
    setSessionToken(outcome.data.token);
    return authResult();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (): Promise<AuthResult> => {
    // Best effort: even if the API call fails, this process must forget the
    // token, because "sign out did nothing" is worse than a stale session row.
    await callApi('POST', '/auth/logout');
    setSessionToken(null);
    return { ok: true, error: null, errorCode: null, state: ANONYMOUS };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_ME, async (): Promise<AuthResult> => authResult());

  ipcMain.handle(IPC_CHANNELS.AUTH_LOCK, async (): Promise<AuthResult> => {
    const outcome = await callApi('POST', '/auth/lock');
    if (!outcome.ok) return authResult(outcome.error, outcome.errorCode);
    return authResult();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_UNLOCK, async (_event, payload): Promise<AuthResult> => {
    const parsed = validateInput(unlockInputSchema, payload);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, errorCode: 'VALIDATION_FAILED', state: ANONYMOUS };
    }

    const outcome = await callApi('POST', '/auth/unlock', parsed.value);
    if (!outcome.ok) return authResult(outcome.error, outcome.errorCode);
    return authResult();
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
    async (_event, payload): Promise<AuthResult> => {
      const parsed = validateInput(changePasswordSchema, payload);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error, errorCode: 'VALIDATION_FAILED', state: ANONYMOUS };
      }

      const outcome = await callApi('POST', '/auth/change-password', parsed.value);
      if (!outcome.ok) return authResult(outcome.error, outcome.errorCode);
      return authResult();
    },
  );

  // ── Users ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.USERS_LIST, async (_event, payload) => {
    const parsed = validateInput(userListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      search: parsed.value.search,
      status: parsed.value.status,
      role: parsed.value.role,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/users${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.USERS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createUserSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/users', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.USERS_UPDATE, async (_event, payload) => {
    const parsed = validateInput(updateUserInputSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/users/${String(parsed.value.id)}`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.USERS_SET_STATUS, async (_event, payload) => {
    const parsed = validateInput(setUserStatusInputSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/users/${String(parsed.value.id)}/status`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.USERS_RESET_PASSWORD, async (_event, payload) => {
    const parsed = validateInput(userIdInputSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/users/${String(parsed.value.id)}/reset-password`,
      {},
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Roles and permissions ────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.ROLES_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/roles');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PERMISSIONS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/permissions');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.ROLE_SET_PERMISSIONS, async (_event, payload) => {
    const parsed = validateInput(rolePermissionsInputSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/roles/${encodeURIComponent(parsed.value.code)}/permissions`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Audit log ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUDIT_LIST, async (_event, payload) => {
    const parsed = validateInput(auditListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      action: parsed.value.action,
      entityType: parsed.value.entityType,
      actorUserId: parsed.value.actorUserId,
      from: parsed.value.from,
      to: parsed.value.to,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/audit-logs${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/settings');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, payload) => {
    const parsed = validateInput(settingUpdateInputSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/settings/${encodeURIComponent(parsed.value.key)}`,
      { value: parsed.value.value },
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Catalog: service types and plans ─────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_TYPES_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/service-types');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_LIST, async (_event, payload) => {
    const parsed = validateInput(planListQuerySchema, normalisePlanQuery(payload));
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      search: parsed.value.search,
      serviceType: parsed.value.serviceType,
      status: parsed.value.status,
      currentOnly: parsed.value.currentOnly ? 'true' : 'false',
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/plans${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/plans/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createPlanSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/plans', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_UPDATE, async (_event, payload) => {
    const parsed = validateInput(withBody(updatePlanSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/plans/${String(parsed.value.id)}`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_CHANGE_PRICE, async (_event, payload) => {
    // A price change is a POST to a sub-resource: it creates a version rather
    // than editing the plan.
    const parsed = validateInput(withBody(changePlanPriceSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/plans/${String(parsed.value.id)}/price`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PLANS_RETIRE, async (_event, payload) => {
    const parsed = validateInput(withBody(retirePlanSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/plans/${String(parsed.value.id)}/retire`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Collection areas and collectors ──────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.COLLECTION_AREAS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/collection-areas');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_AREAS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createCollectionAreaSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/collection-areas', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTORS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/collectors');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.RECEIVABLES_LIST, async (_event, payload) => {
    const parsed = validateInput(receivableListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');
    const query = toQueryString({
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
      collectorId: parsed.value.collectorId,
      collectionAreaId: parsed.value.collectionAreaId,
      servicePlanId: parsed.value.servicePlanId,
      serviceTypeCode: parsed.value.serviceTypeCode,
      agingBucket: parsed.value.agingBucket,
      overdueOnly: parsed.value.overdueOnly,
    });
    const outcome = await callApi<unknown[]>('GET', `/receivables${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);
    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.RECEIVABLES_AGING, async () => {
    const outcome = await callApi<unknown>('GET', '/receivables/aging');
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.RECEIVABLES_CANDIDATES, async (_event, payload) => {
    const parsed = validateInput(receivableListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');
    const query = toQueryString({ page: parsed.value.page, pageSize: parsed.value.pageSize });
    const outcome = await callApi<unknown[]>('GET', `/receivables/suspension-candidates${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);
    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.REPORTS_DASHBOARD, async () => {
    const outcome = await callApi<unknown>('GET', '/dashboard');
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.REPORTS_GET, async (_event, payload) => {
    const parsed = validateInput(reportQuerySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);
    const query = toQueryString(parsed.value);
    const outcome = await callApi<unknown>('GET', `/reports${query}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  /*
   * Export a report to a file.
   *
   * The bytes come from the API as-is — this process neither parses nor
   * re-encodes them, so an XLSX stays a valid ZIP and a PDF stays a valid PDF.
   * The save dialog belongs here rather than in the renderer because only the
   * main process may touch the filesystem, and the path the user picked is the
   * only thing returned.
   */
  ipcMain.handle(
    IPC_CHANNELS.REPORTS_EXPORT,
    async (event, payload): Promise<ReportExportResult> => {
      const parsed = validateInput(reportExportSchema, payload);
      if (!parsed.ok) return exportFailure(parsed.error, 'VALIDATION_FAILED');

      const { format, ...filters } = parsed.value;
      const outcome = await callApiBytes(`/reports/export${toQueryString({ ...filters, format })}`);
      if (!outcome.ok) return exportFailure(outcome.error, outcome.errorCode);

      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Export report',
        defaultPath: `${parsed.value.type.toLowerCase()}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      };
      const result =
        owner === null
          ? await dialog.showSaveDialog(options)
          : await dialog.showSaveDialog(owner, options);

      if (result.canceled || result.filePath === undefined) {
        return exportFailure('Export cancelled.', 'CANCELLED');
      }

      try {
        await writeFile(result.filePath, Buffer.from(outcome.data));
      } catch (error) {
        return exportFailure(
          error instanceof Error ? error.message : 'Could not write the export file.',
          'EXPORT_WRITE_FAILED',
        );
      }

      return { ok: true, filePath: result.filePath, error: null, errorCode: null };
    },
  );

  // ── Subscribers ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_LIST, async (_event, payload) => {
    const parsed = validateInput(subscriberListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      search: parsed.value.search,
      status: parsed.value.status,
      subscriberType: parsed.value.subscriberType,
      collectionAreaId: parsed.value.collectionAreaId,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/subscribers${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/subscribers/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createSubscriberSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/subscribers', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_UPDATE, async (_event, payload) => {
    const parsed = validateInput(withBody(updateSubscriberSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/subscribers/${String(parsed.value.id)}`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_SET_STATUS, async (_event, payload) => {
    const parsed = validateInput(withBody(setSubscriberStatusSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/subscribers/${String(parsed.value.id)}/status`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_REPLACE_ADDRESSES, async (_event, payload) => {
    const parsed = validateInput(
      z.object({
        id: z.number().int().positive(),
        addresses: replaceAddressesSchema.shape.addresses,
      }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/subscribers/${String(parsed.value.id)}/addresses`,
      { addresses: parsed.value.addresses },
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SUBSCRIBERS_REPLACE_CONTACTS, async (_event, payload) => {
    const parsed = validateInput(
      z.object({
        id: z.number().int().positive(),
        contacts: replaceContactsSchema.shape.contacts,
      }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/subscribers/${String(parsed.value.id)}/contacts`,
      { contacts: parsed.value.contacts },
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Service accounts ─────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_LIST, async (_event, payload) => {
    const parsed = validateInput(serviceAccountListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      search: parsed.value.search,
      status: parsed.value.status,
      subscriberId: parsed.value.subscriberId,
      serviceType: parsed.value.serviceType,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/service-accounts${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/service-accounts/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createServiceAccountSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/service-accounts', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_UPDATE, async (_event, payload) => {
    const parsed = validateInput(withBody(updateServiceAccountSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PUT',
      `/service-accounts/${String(parsed.value.id)}`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_SET_STATUS, async (_event, payload) => {
    const parsed = validateInput(withBody(setServiceAccountStatusSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/service-accounts/${String(parsed.value.id)}/status`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_APPLY_RATE, async (_event, payload) => {
    const parsed = validateInput(withBody(applyPlanRateSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/service-accounts/${String(parsed.value.id)}/apply-rate`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.SERVICE_ACCOUNTS_CHANGE_PLAN, async (_event, payload) => {
    const parsed = validateInput(withBody(changeServiceAccountPlanSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/service-accounts/${String(parsed.value.id)}/change-plan`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Search ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SEARCH_PROVIDERS, async () => {
    const outcome = await callApi<unknown[]>('GET', '/search/providers');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SEARCH_SUBSCRIBERS, async (_event, payload) => {
    const parsed = validateInput(subscriberSearchQuerySchema, payload);
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({ q: parsed.value.q, limit: parsed.value.limit });
    const outcome = await callApi<unknown[]>('GET', `/search/subscribers${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  // ── Billing ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.BILLING_DASHBOARD, async () => {
    const outcome = await callApi<unknown>('GET', '/billing/dashboard');
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.BILLING_CYCLES, async () => {
    const outcome = await callApi<unknown[]>('GET', '/billing/cycles');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  // The preview is a GET with a query string on the API, because it writes
  // nothing. This handler keeps that shape rather than inventing a POST.
  ipcMain.handle(IPC_CHANNELS.BILLING_PREVIEW, async (_event, payload) => {
    const parsed = validateInput(generateBillingSchema, { ...(payload as object), dryRun: true });
    if (!parsed.ok) return itemFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      month: parsed.value.month,
      dryRun: 'true',
      collectionAreaId: parsed.value.collectionAreaId,
    });

    const outcome = await callApi<unknown>('GET', `/billing/preview${query}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.BILLING_GENERATE, async (_event, payload) => {
    const parsed = validateInput(generateBillingSchema, payload);
    if (!parsed.ok) return itemFailure(parsed.error, 'VALIDATION_FAILED');

    const outcome = await callApi<unknown>('POST', '/billing/generate', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.BILLING_APPLY_PENALTIES, async (_event, payload) => {
    const parsed = validateInput(applyPenaltiesSchema, payload ?? {});
    if (!parsed.ok) return itemFailure(parsed.error, 'VALIDATION_FAILED');

    const outcome = await callApi<unknown>('POST', '/billing/apply-penalties', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Invoices ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.INVOICES_LIST, async (_event, payload) => {
    const parsed = validateInput(invoiceListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      search: parsed.value.search,
      status: parsed.value.status,
      displayStatus: parsed.value.displayStatus,
      month: parsed.value.month,
      subscriberId: parsed.value.subscriberId,
      serviceAccountId: parsed.value.serviceAccountId,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/invoices${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.INVOICES_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/invoices/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.INVOICE_FINALIZE, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: finalizeInvoiceSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/invoices/${String(parsed.value.id)}/finalize`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.INVOICE_VOID, async (_event, payload) => {
    const parsed = validateInput(withBody(voidInvoiceSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/invoices/${String(parsed.value.id)}/void`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.INVOICE_ADJUST, async (_event, payload) => {
    const parsed = validateInput(withBody(createAdjustmentSchema), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/invoices/${String(parsed.value.id)}/adjustments`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Ledger ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.LEDGER_SUBSCRIBER, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), query: ledgerQuerySchema }),
      payload,
    );
    if (!parsed.ok) return itemFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      serviceAccountId: parsed.value.query.serviceAccountId,
      from: parsed.value.query.from,
      to: parsed.value.query.to,
      page: parsed.value.query.page,
      pageSize: parsed.value.query.pageSize,
    });

    const outcome = await callApi<unknown>(
      'GET',
      `/ledger/subscribers/${String(parsed.value.id)}${query}`,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.LEDGER_SERVICE_ACCOUNT, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), query: ledgerQuerySchema }),
      payload,
    );
    if (!parsed.ok) return itemFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      from: parsed.value.query.from,
      to: parsed.value.query.to,
      page: parsed.value.query.page,
      pageSize: parsed.value.query.pageSize,
    });

    const outcome = await callApi<unknown>(
      'GET',
      `/ledger/service-accounts/${String(parsed.value.id)}${query}`,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Payments ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.PAYMENTS_LIST, async (_event, payload) => {
    const parsed = validateInput(paymentListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      status: parsed.value.status,
      paymentMethod: parsed.value.paymentMethod,
      subscriberId: parsed.value.subscriberId,
      serviceAccountId: parsed.value.serviceAccountId,
      search: parsed.value.search,
      from: parsed.value.from,
      to: parsed.value.to,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/payments${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/payments/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_PREVIEW, async (_event, payload) => {
    const parsed = validateInput(createPaymentSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/payments/preview', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_CREATE, async (_event, payload) => {
    const parsed = validateInput(createPaymentSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/payments', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_PENDING, async (_event, payload) => {
    const parsed = validateInput(paymentListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    // `status` is not forwarded: the route pins it to PENDING_VERIFICATION, and
    // sending one would be a second source of truth for what this queue is.
    const query = toQueryString({
      search: parsed.value.search,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/payments/pending-verification${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_VERIFY, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: verifyPaymentSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/payments/${String(parsed.value.id)}/verify`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.PAYMENTS_REVERSE, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: reversePaymentSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/payments/${String(parsed.value.id)}/reverse`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  // ── Collections ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_LIST, async (_event, payload) => {
    const parsed = validateInput(collectionBatchListQuerySchema, payload ?? {});
    if (!parsed.ok) return listFailure(parsed.error, 'VALIDATION_FAILED');

    const query = toQueryString({
      status: parsed.value.status,
      collectorUserId: parsed.value.collectorUserId,
      collectionAreaId: parsed.value.collectionAreaId,
      page: parsed.value.page,
      pageSize: parsed.value.pageSize,
    });

    const outcome = await callApi<unknown[]>('GET', `/collection-batches${query}`);
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.meta?.total ?? outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_GET, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('GET', `/collection-batches/${String(parsed.value.id)}`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_CREATE, async (_event, payload) => {
    const parsed = validateInput(createCollectionBatchSchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', '/collection-batches', parsed.value);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_START, async (_event, payload) => {
    const parsed = validateInput(idOnlySchema, payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/collection-batches/${String(parsed.value.id)}/start`,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_SUBMIT, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: submitCollectionBatchSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/collection-batches/${String(parsed.value.id)}/submit`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_REMIT, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: batchRemittanceSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/collection-batches/${String(parsed.value.id)}/remit`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_RECONCILE, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: batchReconciliationSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/collection-batches/${String(parsed.value.id)}/reconcile`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_BATCHES_CLOSE, async (_event, payload) => {
    const parsed = validateInput(
      z.object({ id: z.number().int().positive(), input: closeCollectionBatchSchema }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'PATCH',
      `/collection-batches/${String(parsed.value.id)}/close`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_ASSIGNMENTS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/collection-assignments');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_AREAS_ASSIGN, async (_event, payload) => {
    const parsed = validateInput(
      z.object({
        areaId: z.number().int().positive(),
        input: collectorAssignmentSchema,
      }),
      payload,
    );
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>(
      'POST',
      `/collection-areas/${String(parsed.value.areaId)}/assign-collector`,
      parsed.value.input,
    );
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.COLLECTION_REMITTANCES_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/collection-remittances');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  // ── Backup ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.BACKUPS_LIST, async () => {
    const outcome = await callApi<unknown[]>('GET', '/backups');
    if (!outcome.ok) return listFailure(outcome.error, outcome.errorCode);

    return {
      ok: true,
      items: outcome.data,
      total: outcome.data.length,
      error: null,
      errorCode: null,
    };
  });

  ipcMain.handle(IPC_CHANNELS.BACKUPS_CREATE, async () => {
    const outcome = await callApi<unknown>('POST', '/backups');
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.BACKUPS_VERIFY, async (_event, payload) => {
    const parsed = validateInput(z.object({ backupId: z.string().uuid() }), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', `/backups/${parsed.value.backupId}/verify`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });

  ipcMain.handle(IPC_CHANNELS.BACKUPS_RESTORE, async (_event, payload) => {
    const parsed = validateInput(z.object({ backupId: z.string().uuid() }), payload);
    if (!parsed.ok) return rejected(parsed.error);

    const outcome = await callApi<unknown>('POST', `/backups/${parsed.value.backupId}/restore`);
    return outcome.ok ? ok(outcome.data) : itemFailure(outcome.error, outcome.errorCode);
  });
}
