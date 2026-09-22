import type {
  ApplyPenaltiesInput,
  ApplyPlanRateInput,
  AuditEntry,
  AuditListQuery,
  BatchReconciliationInput,
  BatchRemittanceInput,
  BackupHistory,
  BillingCycleSummary,
  BillingDashboard,
  BillingPreview,
  BillingRunResult,
  ChangePlanPriceInput,
  ChangeServiceAccountPlanInput,
  CloseCollectionBatchInput,
  CollectionAreaSummary,
  CollectionBatchDetail,
  CollectionBatchListQuery,
  CollectionBatchSummary,
  CollectorAssignmentSummary,
  CollectorSummary,
  CreateAdjustmentInput,
  CreateCollectionAreaRequest,
  CreateCollectionBatchInput,
  CreatePaymentInput,
  CreatePlanRequest,
  CreateServiceAccountRequest,
  CreateSubscriberRequest,
  CreateUserInput,
  FinalizeInvoiceInput,
  GenerateBillingInput,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceSummary,
  LedgerQuery,
  LedgerStatement,
  PaymentDetail,
  PaymentListQuery,
  PaymentPreview,
  PaymentSummary,
  PermissionSummary,
  PlanListQuery,
  PlanSummary,
  RemittanceSummary,
  RetirePlanInput,
  ReversePaymentInput,
  RoleSummary,
  SearchProvider,
  ServiceAccountDetail,
  ServiceAccountListQuery,
  ServiceAccountSummary,
  ServiceTypeSummary,
  SessionUser,
  SetRolePermissionsInput,
  SetServiceAccountStatusInput,
  SetSubscriberStatusInput,
  SetUserStatusInput,
  Setting,
  SubmitCollectionBatchInput,
  SubscriberAddressInput,
  SubscriberContactInput,
  SubscriberDetail,
  SubscriberListQuery,
  SubscriberSummary,
  UpdatePlanInput,
  UpdateServiceAccountInput,
  UpdateSubscriberInput,
  UpdateUserInput,
  UserListQuery,
  UserSummary,
  VerifyPaymentInput,
  VoidInvoiceInput,
  AgingSummary,
  ReceivableListQuery,
  ReceivableSummary,
  SuspensionCandidate,
  Dashboard,
  ReportQuery,
  ReportResult,
} from '@bcis/validation';

/**
 * The IPC contract between the Electron main process and the renderer.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
 * and `sandbox: true`. It has no network access, no filesystem access, and no
 * session token. Every resource it needs comes through a named channel listed
 * below, and the preload script exposes exactly these channels and nothing
 * else.
 *
 * Keeping the channel names and payload types in one shared file means the
 * main process handler and the renderer caller cannot drift apart without the
 * type checker noticing.
 *
 * ── ADDING A CHANNEL ────────────────────────────────────────────────────────
 * 1. Add the channel constant here.
 * 2. Add its request/response types here.
 * 3. Handle it in `src/main/ipc.ts` with `ipcMain.handle`, validating the
 *    payload with the same Zod schema the API uses.
 * 4. Expose it in `src/preload/index.ts`.
 *
 * The renderer is not trusted: a user can open DevTools and call any exposed
 * function with any argument.
 */

export const IPC_CHANNELS = {
  HEALTH_CHECK: 'health:check',
  APP_INFO: 'app:info',

  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_ME: 'auth:me',
  AUTH_LOCK: 'auth:lock',
  AUTH_UNLOCK: 'auth:unlock',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',

  USERS_LIST: 'users:list',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_SET_STATUS: 'users:set-status',
  USERS_RESET_PASSWORD: 'users:reset-password',

  ROLES_LIST: 'roles:list',
  PERMISSIONS_LIST: 'permissions:list',
  ROLE_SET_PERMISSIONS: 'role:set-permissions',

  AUDIT_LIST: 'audit:list',

  SETTINGS_LIST: 'settings:list',
  SETTINGS_UPDATE: 'settings:update',

  // --- Phase 3: catalog, subscribers, service accounts --------------------
  SERVICE_TYPES_LIST: 'service-types:list',

  PLANS_LIST: 'plans:list',
  PLANS_GET: 'plans:get',
  PLANS_CREATE: 'plans:create',
  PLANS_UPDATE: 'plans:update',
  PLANS_CHANGE_PRICE: 'plans:change-price',
  PLANS_RETIRE: 'plans:retire',

  COLLECTION_AREAS_LIST: 'collection-areas:list',
  COLLECTION_AREAS_CREATE: 'collection-areas:create',
  COLLECTORS_LIST: 'collectors:list',

  SUBSCRIBERS_LIST: 'subscribers:list',
  SUBSCRIBERS_GET: 'subscribers:get',
  SUBSCRIBERS_CREATE: 'subscribers:create',
  SUBSCRIBERS_UPDATE: 'subscribers:update',
  SUBSCRIBERS_SET_STATUS: 'subscribers:set-status',
  SUBSCRIBERS_REPLACE_ADDRESSES: 'subscribers:replace-addresses',
  SUBSCRIBERS_REPLACE_CONTACTS: 'subscribers:replace-contacts',

  SERVICE_ACCOUNTS_LIST: 'service-accounts:list',
  SERVICE_ACCOUNTS_GET: 'service-accounts:get',
  SERVICE_ACCOUNTS_CREATE: 'service-accounts:create',
  SERVICE_ACCOUNTS_UPDATE: 'service-accounts:update',
  SERVICE_ACCOUNTS_SET_STATUS: 'service-accounts:set-status',
  SERVICE_ACCOUNTS_APPLY_RATE: 'service-accounts:apply-rate',
  SERVICE_ACCOUNTS_CHANGE_PLAN: 'service-accounts:change-plan',

  SEARCH_PROVIDERS: 'search:providers',
  SEARCH_SUBSCRIBERS: 'search:subscribers',

  // --- Phase 4: billing, invoices, ledger ---------------------------------
  BILLING_DASHBOARD: 'billing:dashboard',
  BILLING_CYCLES: 'billing:cycles',
  BILLING_PREVIEW: 'billing:preview',
  BILLING_GENERATE: 'billing:generate',
  BILLING_APPLY_PENALTIES: 'billing:apply-penalties',

  INVOICES_LIST: 'invoices:list',
  INVOICES_GET: 'invoices:get',
  INVOICE_FINALIZE: 'invoices:finalize',
  INVOICE_VOID: 'invoices:void',
  INVOICE_ADJUST: 'invoices:adjust',

  LEDGER_SUBSCRIBER: 'ledger:subscriber',
  LEDGER_SERVICE_ACCOUNT: 'ledger:service-account',

  RECEIVABLES_LIST: 'receivables:list',
  RECEIVABLES_AGING: 'receivables:aging',
  RECEIVABLES_CANDIDATES: 'receivables:candidates',
  REPORTS_DASHBOARD: 'reports:dashboard',
  REPORTS_GET: 'reports:get',

  // --- Phase 5: payments ----------------------------------------------------
  PAYMENTS_LIST: 'payments:list',
  PAYMENTS_GET: 'payments:get',
  PAYMENTS_PREVIEW: 'payments:preview',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_PENDING: 'payments:pending',
  PAYMENTS_VERIFY: 'payments:verify',
  PAYMENTS_REVERSE: 'payments:reverse',

  // --- Phase 6: collections -------------------------------------------------
  COLLECTION_BATCHES_LIST: 'collection-batches:list',
  COLLECTION_BATCHES_GET: 'collection-batches:get',
  COLLECTION_BATCHES_CREATE: 'collection-batches:create',
  COLLECTION_BATCHES_START: 'collection-batches:start',
  COLLECTION_BATCHES_SUBMIT: 'collection-batches:submit',
  COLLECTION_BATCHES_REMIT: 'collection-batches:remit',
  COLLECTION_BATCHES_RECONCILE: 'collection-batches:reconcile',
  COLLECTION_BATCHES_CLOSE: 'collection-batches:close',
  COLLECTION_ASSIGNMENTS_LIST: 'collection-assignments:list',
  COLLECTION_AREAS_ASSIGN: 'collection-areas:assign',
  COLLECTION_REMITTANCES_LIST: 'collection-remittances:list',

  // --- Phase 9: backup ------------------------------------------------------
  BACKUPS_LIST: 'backups:list',
  BACKUPS_CREATE: 'backups:create',
  BACKUPS_VERIFY: 'backups:verify',
  BACKUPS_RESTORE: 'backups:restore',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Result of probing the API, and through it the database. */
export interface HealthCheckResult {
  /** True only when the API is reachable AND the database is connected. */
  readonly ok: boolean;
  readonly api: {
    readonly reachable: boolean;
    readonly baseUrl: string;
    readonly status: string | null;
    readonly version: string | null;
    readonly latencyMs: number;
    readonly error: string | null;
  };
  readonly database: {
    readonly connected: boolean;
    /**
     * `ok`         — reachable and fully migrated
     * `degraded`   — reachable but migrations are pending
     * `unavailable`— not reachable
     */
    readonly status: 'ok' | 'degraded' | 'unavailable' | null;
    readonly latencyMs: number | null;
    readonly serverVersion: string | null;
    readonly appliedMigrations: number | null;
    readonly pendingMigrations: readonly string[];
    readonly error: string | null;
  };
  readonly checkedAt: string;
}

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly apiBaseUrl: string;
}

/**
 * The signed-in user as the renderer is allowed to see it.
 *
 * No password hash, no session token — the token never leaves the main process,
 * which is why a renderer compromise cannot steal a session.
 */
export type RendererUser = SessionUser;

export interface AuthState {
  readonly authenticated: boolean;
  /** A locked session may only call `auth.unlock`. */
  readonly locked: boolean;
  readonly user: RendererUser | null;
}

/** Every mutation result carries whether it worked and why not. */
export interface ActionResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
}

export interface ListResult<T> extends ActionResult {
  readonly items: readonly T[];
  readonly total: number;
}

export interface ItemResult<T> extends ActionResult {
  readonly item: T | null;
}

export interface AuthResult extends ActionResult {
  readonly state: AuthState;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

export interface UnlockRequest {
  readonly password: string;
}

export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ResetPasswordResult {
  readonly user: UserSummary;
  /**
   * Shown to the administrator once so it can be handed over. Never logged, and
   * the account must change it at next sign-in.
   */
  readonly temporaryPassword: string;
}

/** The complete surface exposed to the renderer as `window.bcis`. */
export interface BcisBridge {
  readonly health: {
    readonly check: () => Promise<HealthCheckResult>;
  };
  readonly app: {
    readonly info: () => Promise<AppInfo>;
  };
  readonly auth: {
    readonly login: (input: LoginRequest) => Promise<AuthResult>;
    readonly logout: () => Promise<AuthResult>;
    readonly me: () => Promise<AuthResult>;
    readonly lock: () => Promise<AuthResult>;
    readonly unlock: (input: UnlockRequest) => Promise<AuthResult>;
    readonly changePassword: (input: ChangePasswordRequest) => Promise<AuthResult>;
  };
  readonly users: {
    readonly list: (query: Partial<UserListQuery>) => Promise<ListResult<UserSummary>>;
    readonly create: (input: CreateUserInput) => Promise<ItemResult<UserSummary>>;
    readonly update: (id: number, input: UpdateUserInput) => Promise<ItemResult<UserSummary>>;
    readonly setStatus: (id: number, input: SetUserStatusInput) => Promise<ItemResult<UserSummary>>;
    readonly resetPassword: (id: number) => Promise<ItemResult<ResetPasswordResult>>;
  };
  readonly roles: {
    readonly list: () => Promise<ListResult<RoleSummary>>;
    readonly setPermissions: (
      code: string,
      input: SetRolePermissionsInput,
    ) => Promise<ItemResult<RoleSummary>>;
  };
  readonly permissions: {
    readonly list: () => Promise<ListResult<PermissionSummary>>;
  };
  readonly audit: {
    readonly list: (query: Partial<AuditListQuery>) => Promise<ListResult<AuditEntry>>;
  };
  readonly settings: {
    readonly list: () => Promise<ListResult<Setting>>;
    readonly update: (key: string, value: string) => Promise<ItemResult<Setting>>;
  };

  // ── Phase 3 ──────────────────────────────────────────────────────────────
  readonly serviceTypes: {
    readonly list: () => Promise<ListResult<ServiceTypeSummary>>;
  };
  readonly plans: {
    readonly list: (query: Partial<PlanListQuery>) => Promise<ListResult<PlanSummary>>;
    readonly get: (id: number) => Promise<ItemResult<PlanSummary>>;
    readonly create: (input: CreatePlanRequest) => Promise<ItemResult<PlanSummary>>;
    readonly update: (id: number, input: UpdatePlanInput) => Promise<ItemResult<PlanSummary>>;
    /** Creates a new price version. Never edits an existing amount. */
    readonly changePrice: (
      id: number,
      input: ChangePlanPriceInput,
    ) => Promise<ItemResult<PlanSummary>>;
    readonly retire: (id: number, input: RetirePlanInput) => Promise<ItemResult<PlanSummary>>;
  };
  readonly collectionAreas: {
    readonly list: () => Promise<ListResult<CollectionAreaSummary>>;
    readonly create: (
      input: CreateCollectionAreaRequest,
    ) => Promise<ItemResult<CollectionAreaSummary>>;
  };
  readonly collectors: {
    readonly list: () => Promise<ListResult<CollectorSummary>>;
  };
  readonly subscribers: {
    readonly list: (query: Partial<SubscriberListQuery>) => Promise<ListResult<SubscriberSummary>>;
    readonly get: (id: number) => Promise<ItemResult<SubscriberDetail>>;
    readonly create: (input: CreateSubscriberRequest) => Promise<ItemResult<SubscriberDetail>>;
    readonly update: (
      id: number,
      input: UpdateSubscriberInput,
    ) => Promise<ItemResult<SubscriberDetail>>;
    readonly setStatus: (
      id: number,
      input: SetSubscriberStatusInput,
    ) => Promise<ItemResult<SubscriberDetail>>;
    /** The whole address set, with ids so rows are updated rather than recreated. */
    readonly replaceAddresses: (
      id: number,
      addresses: readonly SubscriberAddressInput[],
    ) => Promise<ItemResult<SubscriberDetail>>;
    readonly replaceContacts: (
      id: number,
      contacts: readonly SubscriberContactInput[],
    ) => Promise<ItemResult<SubscriberDetail>>;
  };
  readonly serviceAccounts: {
    readonly list: (
      query: Partial<ServiceAccountListQuery>,
    ) => Promise<ListResult<ServiceAccountSummary>>;
    readonly get: (id: number) => Promise<ItemResult<ServiceAccountDetail>>;
    readonly create: (
      input: CreateServiceAccountRequest,
    ) => Promise<ItemResult<ServiceAccountDetail>>;
    readonly update: (
      id: number,
      input: UpdateServiceAccountInput,
    ) => Promise<ItemResult<ServiceAccountDetail>>;
    readonly setStatus: (
      id: number,
      input: SetServiceAccountStatusInput,
    ) => Promise<ItemResult<ServiceAccountDetail>>;
    readonly applyRate: (
      id: number,
      input: ApplyPlanRateInput,
    ) => Promise<ItemResult<ServiceAccountDetail>>;
    readonly changePlan: (
      id: number,
      input: ChangeServiceAccountPlanInput,
    ) => Promise<ItemResult<ServiceAccountDetail>>;
  };
  readonly receivables: {
    readonly list: (query: Partial<ReceivableListQuery>) => Promise<ListResult<ReceivableSummary>>;
    readonly aging: () => Promise<ItemResult<AgingSummary>>;
    readonly candidates: (
      query: Partial<ReceivableListQuery>,
    ) => Promise<ListResult<SuspensionCandidate>>;
  };
  readonly reports: {
    readonly dashboard: () => Promise<ItemResult<Dashboard>>;
    readonly get: (query: ReportQuery) => Promise<ItemResult<ReportResult>>;
  };
  readonly search: {
    readonly providers: () => Promise<ListResult<SearchProvider>>;
    readonly subscribers: (term: string, limit?: number) => Promise<ListResult<SubscriberSummary>>;
  };

  // ── Phase 4 ──────────────────────────────────────────────────────────────
  readonly billing: {
    readonly dashboard: () => Promise<ItemResult<BillingDashboard>>;
    readonly cycles: () => Promise<ListResult<BillingCycleSummary>>;
    /** Writes nothing. The confirmation screen is built from this. */
    readonly preview: (input: GenerateBillingInput) => Promise<ItemResult<BillingPreview>>;
    readonly generate: (input: GenerateBillingInput) => Promise<ItemResult<BillingRunResult>>;
    readonly applyPenalties: (input: ApplyPenaltiesInput) => Promise<ItemResult<PenaltyRunOutcome>>;
  };
  readonly invoices: {
    readonly list: (query: Partial<InvoiceListQuery>) => Promise<ListResult<InvoiceSummary>>;
    readonly get: (id: number) => Promise<ItemResult<InvoiceDetail>>;
    readonly finalize: (
      id: number,
      input: FinalizeInvoiceInput,
    ) => Promise<ItemResult<InvoiceDetail>>;
    readonly void: (id: number, input: VoidInvoiceInput) => Promise<ItemResult<InvoiceDetail>>;
    readonly adjust: (
      id: number,
      input: CreateAdjustmentInput,
    ) => Promise<ItemResult<InvoiceDetail>>;
  };
  readonly ledger: {
    readonly subscriber: (id: number, query: LedgerQuery) => Promise<ItemResult<LedgerStatement>>;
    readonly serviceAccount: (
      id: number,
      query: LedgerQuery,
    ) => Promise<ItemResult<LedgerStatement>>;
  };

  // ── Phase 5 ──────────────────────────────────────────────────────────────
  readonly payments: {
    readonly list: (query: Partial<PaymentListQuery>) => Promise<ListResult<PaymentSummary>>;
    readonly get: (id: number) => Promise<ItemResult<PaymentDetail>>;
    /** Writes nothing. The confirmation is built from this. */
    readonly preview: (input: CreatePaymentInput) => Promise<ItemResult<PaymentPreview>>;
    readonly create: (input: CreatePaymentInput) => Promise<ItemResult<PaymentDetail>>;
    readonly pending: () => Promise<ListResult<PaymentSummary>>;
    readonly verify: (id: number, input: VerifyPaymentInput) => Promise<ItemResult<PaymentDetail>>;
    readonly reverse: (id: number, input: ReversePaymentInput) => Promise<ItemResult<PaymentDetail>>;
  };

  // ── Phase 6 ──────────────────────────────────────────────────────────────
  readonly collectionBatches: {
    readonly list: (
      query: Partial<CollectionBatchListQuery>,
    ) => Promise<ListResult<CollectionBatchSummary>>;
    readonly get: (id: number) => Promise<ItemResult<CollectionBatchDetail>>;
    readonly create: (
      input: CreateCollectionBatchInput,
    ) => Promise<ItemResult<CollectionBatchSummary>>;
    readonly start: (id: number) => Promise<ItemResult<{ status: string }>>;
    readonly submit: (
      id: number,
      input: SubmitCollectionBatchInput,
    ) => Promise<
      ItemResult<{ status: string; totalCollectedCentavos: number; uncollectedCentavos: number }>
    >;
    readonly remit: (
      id: number,
      input: BatchRemittanceInput,
    ) => Promise<ItemResult<{ varianceCentavos: number; varianceType: string; status: string }>>;
    readonly reconcile: (
      id: number,
      input: BatchReconciliationInput,
    ) => Promise<ItemResult<{ differenceCentavos: number; status: string }>>;
    readonly close: (id: number, input: CloseCollectionBatchInput) => Promise<ItemResult<{ status: string }>>;
  };
  readonly collectionAssignments: {
    readonly list: () => Promise<ListResult<CollectorAssignmentSummary>>;
    readonly assign: (
      areaId: number,
      input: { collectorUserId: number; effectiveFrom: string },
    ) => Promise<ItemResult<{ id: number }>>;
  };
  readonly collectionRemittances: {
    readonly list: () => Promise<ListResult<RemittanceSummary>>;
  };

  // ── Phase 9 ──────────────────────────────────────────────────────────────
  readonly backups: {
    readonly list: () => Promise<ListResult<BackupHistory>>;
    readonly create: () => Promise<ItemResult<{ backupId: string; status: string; path: string }>>;
    readonly verify: (
      backupId: string,
    ) => Promise<ItemResult<{ backupId: string; ok: boolean; notes: string }>>;
    readonly restore: (backupId: string) => Promise<ItemResult<{ backupId: string; status: string }>>;
  };
}

/**
 * What a penalty run reports back.
 *
 * Declared here rather than in `@bcis/validation` because it is a RESULT shape,
 * not an input contract: nothing validates against it, and the API returns it as
 * a plain object.
 */
export interface PenaltyRunOutcome {
  readonly enabled: boolean;
  readonly dryRun: boolean;
  readonly asOf: string;
  readonly basisPoints: number;
  readonly gracePeriodDays: number;
  readonly applied: readonly {
    readonly invoiceNumber: string;
    readonly balanceCentavos: number;
    readonly penaltyCentavos: number;
  }[];
  readonly totalPenaltyCentavos: number;
}
