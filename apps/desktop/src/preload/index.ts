import { IPC_CHANNELS, type BcisBridge } from '@shared/ipc';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — the entire trust boundary between the renderer and Node.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * This file exposes a FIXED SET OF NAMED FUNCTIONS. It never exposes
 * `ipcRenderer` itself, never exposes a generic `invoke(channel, payload)`
 * passthrough, and never exposes `require`, `process`, or any Node module.
 *
 * Exposing `ipcRenderer.invoke` directly would be the classic mistake: the
 * renderer could then call ANY channel the main process handles, including
 * ones added later for privileged operations, which turns the whole IPC
 * surface into an attack surface.
 *
 * ── ARGUMENTS ARE NOT TRUSTED ───────────────────────────────────────────────
 * A user can open DevTools and call `window.bcis.users.create(...)` with
 * anything. Every payload is validated in the main process with the same Zod
 * schema the API uses before it becomes a request.
 *
 * ── THE SESSION TOKEN NEVER PASSES THROUGH HERE ─────────────────────────────
 * `auth.login` returns the user and their permissions. The token stays in the
 * main process, so a renderer compromise cannot steal a session.
 */

const bridge: BcisBridge = {
  health: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.HEALTH_CHECK),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  },
  auth: {
    login: (input) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, input),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    me: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_ME),
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOCK),
    unlock: (input) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_UNLOCK, input),
    changePassword: (input) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, input),
  },
  users: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.USERS_LIST, query),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.USERS_CREATE, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.USERS_UPDATE, { id, input }),
    setStatus: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.USERS_SET_STATUS, { id, input }),
    resetPassword: (id) => ipcRenderer.invoke(IPC_CHANNELS.USERS_RESET_PASSWORD, { id }),
  },
  roles: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.ROLES_LIST),
    setPermissions: (code, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.ROLE_SET_PERMISSIONS, { code, input }),
  },
  permissions: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_LIST),
  },
  audit: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.AUDIT_LIST, query),
  },
  settings: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LIST),
    update: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, { key, value }),
  },
  serviceTypes: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_TYPES_LIST),
  },
  plans: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_GET, { id }),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_CREATE, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_UPDATE, { id, input }),
    changePrice: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_CHANGE_PRICE, { id, input }),
    retire: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PLANS_RETIRE, { id, input }),
  },
  collectionAreas: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_AREAS_LIST),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_AREAS_CREATE, input),
  },
  collectors: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.COLLECTORS_LIST),
  },
  subscribers: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_GET, { id }),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_CREATE, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_UPDATE, { id, input }),
    setStatus: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_SET_STATUS, { id, input }),
    replaceAddresses: (id, addresses) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_REPLACE_ADDRESSES, { id, addresses }),
    replaceContacts: (id, contacts) =>
      ipcRenderer.invoke(IPC_CHANNELS.SUBSCRIBERS_REPLACE_CONTACTS, { id, contacts }),
  },
  serviceAccounts: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_GET, { id }),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_CREATE, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_UPDATE, { id, input }),
    setStatus: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_SET_STATUS, { id, input }),
    applyRate: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_APPLY_RATE, { id, input }),
    changePlan: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVICE_ACCOUNTS_CHANGE_PLAN, { id, input }),
  },
  receivables: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.RECEIVABLES_LIST, query),
    aging: () => ipcRenderer.invoke(IPC_CHANNELS.RECEIVABLES_AGING),
    candidates: (query) => ipcRenderer.invoke(IPC_CHANNELS.RECEIVABLES_CANDIDATES, query),
  },
  reports: {
    dashboard: () => ipcRenderer.invoke(IPC_CHANNELS.REPORTS_DASHBOARD),
    get: (query) => ipcRenderer.invoke(IPC_CHANNELS.REPORTS_GET, query),
    export: (request) => ipcRenderer.invoke(IPC_CHANNELS.REPORTS_EXPORT, request),
  },
  search: {
    providers: () => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_PROVIDERS),
    subscribers: (term, limit) =>
      ipcRenderer.invoke(IPC_CHANNELS.SEARCH_SUBSCRIBERS, {
        q: term,
        ...(limit === undefined ? {} : { limit }),
      }),
  },
  billing: {
    dashboard: () => ipcRenderer.invoke(IPC_CHANNELS.BILLING_DASHBOARD),
    cycles: () => ipcRenderer.invoke(IPC_CHANNELS.BILLING_CYCLES),
    preview: (input) => ipcRenderer.invoke(IPC_CHANNELS.BILLING_PREVIEW, input),
    generate: (input) => ipcRenderer.invoke(IPC_CHANNELS.BILLING_GENERATE, input),
    applyPenalties: (input) => ipcRenderer.invoke(IPC_CHANNELS.BILLING_APPLY_PENALTIES, input),
  },
  invoices: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.INVOICES_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.INVOICES_GET, { id }),
    finalize: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.INVOICE_FINALIZE, { id, input }),
    void: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.INVOICE_VOID, { id, input }),
    adjust: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.INVOICE_ADJUST, { id, input }),
  },
  ledger: {
    subscriber: (id, query) => ipcRenderer.invoke(IPC_CHANNELS.LEDGER_SUBSCRIBER, { id, query }),
    serviceAccount: (id, query) =>
      ipcRenderer.invoke(IPC_CHANNELS.LEDGER_SERVICE_ACCOUNT, { id, query }),
  },
  payments: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_GET, { id }),
    preview: (input) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_PREVIEW, input),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_CREATE, input),
    pending: (query) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_PENDING, query),
    verify: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_VERIFY, { id, input }),
    reverse: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.PAYMENTS_REVERSE, { id, input }),
  },
  collectionBatches: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_LIST, query),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_GET, { id }),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_CREATE, input),
    start: (id) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_START, { id }),
    submit: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_SUBMIT, { id, input }),
    remit: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_REMIT, { id, input }),
    reconcile: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_RECONCILE, { id, input }),
    close: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_BATCHES_CLOSE, { id, input }),
  },
  collectionAssignments: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_ASSIGNMENTS_LIST),
    assign: (areaId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_AREAS_ASSIGN, { areaId, input }),
  },
  collectionRemittances: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_REMITTANCES_LIST),
  },
  backups: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUPS_LIST),
    create: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUPS_CREATE),
    verify: (backupId) => ipcRenderer.invoke(IPC_CHANNELS.BACKUPS_VERIFY, { backupId }),
    restore: (backupId) => ipcRenderer.invoke(IPC_CHANNELS.BACKUPS_RESTORE, { backupId }),
  },
};

contextBridge.exposeInMainWorld('bcis', bridge);
