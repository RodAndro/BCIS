/**
 * @bcis/validation — Zod schemas shared by the API and the desktop client.
 *
 * The API uses these to validate inbound requests. The desktop client uses the
 * same schemas for form validation and to parse responses, so a server-side
 * rule change surfaces in the UI rather than silently diverging.
 */

export {
  MIN_PASSWORD_LENGTH,
  businessDateSchema,
  centavosSchema,
  idParamSchema,
  idSchema,
  noteSchema,
  passwordSchema,
  pesoInputSchema,
  quantitySchema,
  reasonSchema,
  shortTextSchema,
  signedCentavosSchema,
  usernameSchema,
} from './primitives';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPageMeta,
  dateRangeQuerySchema,
  offsetFor,
  paginationQuerySchema,
  sortDirectionSchema,
  sortQuerySchema,
} from './pagination';
export type {
  DateRangeQuery,
  PageMeta,
  PaginationQuery,
  SortDirection,
  SortQuery,
} from './pagination';

export {
  apiErrorSchema,
  apiSuccessSchema,
  errorCodeSchema,
  livenessSchema,
  paginatedBody,
  readinessSchema,
  successBody,
} from './http';
export type { ApiErrorBody, ApiSuccessBody, Liveness, Readiness } from './http';

export {
  authStateSchema,
  changePasswordSchema,
  loginResultSchema,
  loginSchema,
  permissionCodeSchema,
  requiresPermissionSchema,
  roleCodeSchema,
  sessionUserSchema,
  userStatusSchema,
} from './auth';
export type { AuthState, ChangePasswordInput, LoginInput, LoginResult, SessionUser } from './auth';

export {
  createUserSchema,
  resetPasswordSchema,
  setUserStatusSchema,
  updateUserSchema,
  userListQuerySchema,
  userNoteSchema,
  userIdParamSchema,
  userSummarySchema,
} from './users';
export type {
  CreateUserInput,
  ResetPasswordInput,
  SetUserStatusInput,
  UpdateUserInput,
  UserListQuery,
  UserSummary,
} from './users';

export {
  permissionSummarySchema,
  roleCodeParamSchema,
  roleSummarySchema,
  setRolePermissionsSchema,
} from './rbac';
export type { PermissionSummary, RoleSummary, SetRolePermissionsInput } from './rbac';

export { auditEntrySchema, auditListQuerySchema } from './audit';
export type { AuditEntry, AuditListQuery } from './audit';

export {
  isValidSettingValue,
  settingSchema,
  settingValueTypeSchema,
  updateSettingSchema,
} from './settings';
export type { Setting, UpdateSettingInput } from './settings';

export {
  changePlanPriceSchema,
  createPlanSchema,
  planIdParamSchema,
  planListQuerySchema,
  planStatusSchema,
  planSummarySchema,
  retirePlanSchema,
  serviceTypeCodeSchema,
  serviceTypeSummarySchema,
  updatePlanSchema,
} from './catalog';
export type {
  ChangePlanPriceInput,
  CreatePlanInput,
  CreatePlanRequest,
  PlanListQuery,
  PlanSummary,
  RetirePlanInput,
  ServiceTypeCode,
  ServiceTypeSummary,
  UpdatePlanInput,
} from './catalog';

export {
  addressInputSchema,
  addressTypeSchema,
  contactInputSchema,
  contactTypeSchema,
  createSubscriberSchema,
  replaceAddressesSchema,
  replaceContactsSchema,
  setSubscriberStatusSchema,
  subscriberAddressInputSchema,
  subscriberAddressSchema,
  subscriberContactInputSchema,
  subscriberContactSchema,
  subscriberDetailSchema,
  subscriberIdParamSchema,
  subscriberListQuerySchema,
  subscriberStatusSchema,
  subscriberSummarySchema,
  subscriberTypeSchema,
  updateSubscriberSchema,
} from './subscribers';
export type {
  AddressInput,
  AddressType,
  ContactInput,
  ContactType,
  CreateSubscriberInput,
  CreateSubscriberRequest,
  SetSubscriberStatusInput,
  SubscriberAddressInput,
  SubscriberContactInput,
  SubscriberDetail,
  SubscriberListQuery,
  SubscriberStatus,
  SubscriberSummary,
  SubscriberType,
  UpdateSubscriberInput,
} from './subscribers';

export {
  applyPlanRateSchema,
  changeServiceAccountPlanSchema,
  createServiceAccountSchema,
  serviceAccountDetailSchema,
  serviceAccountIdParamSchema,
  serviceAccountListQuerySchema,
  serviceAccountStatusSchema,
  serviceAccountSummarySchema,
  serviceEventSchema,
  serviceEventTypeSchema,
  serviceNoteSchema,
  setServiceAccountStatusSchema,
  updateServiceAccountSchema,
} from './service-accounts';
export type {
  ApplyPlanRateInput,
  ChangeServiceAccountPlanInput,
  CreateServiceAccountInput,
  CreateServiceAccountRequest,
  ServiceAccountDetail,
  ServiceAccountListQuery,
  ServiceAccountStatus,
  ServiceAccountSummary,
  ServiceEvent,
  SetServiceAccountStatusInput,
  UpdateServiceAccountInput,
} from './service-accounts';

export {
  batchReconciliationSchema,
  batchRemittanceSchema,
  batchStatusSchema,
  closeCollectionBatchSchema,
  collectionAreaIdParamSchema,
  collectionAreaSummarySchema,
  collectionBatchAccountSchema,
  collectionBatchDetailSchema,
  collectionBatchIdParamSchema,
  collectionBatchListQuerySchema,
  collectionBatchSummarySchema,
  collectorAssignmentSchema,
  collectorAssignmentSummarySchema,
  collectorSummarySchema,
  createCollectionAreaSchema,
  createCollectionBatchSchema,
  remittanceSummarySchema,
  routeSheetEntrySchema,
  submitCollectionBatchSchema,
  updateCollectionAreaSchema,
  varianceApprovalSchema,
} from './collection';
export type {
  BatchReconciliationInput,
  BatchRemittanceInput,
  CloseCollectionBatchInput,
  CollectionAreaSummary,
  CollectionBatchAccount,
  CollectionBatchDetail,
  CollectionBatchListQuery,
  CollectionBatchSummary,
  CollectorAssignmentSummary,
  CollectorSummary,
  CreateCollectionAreaInput,
  CreateCollectionAreaRequest,
  CreateCollectionBatchInput,
  RemittanceSummary,
  RouteSheetEntry,
  SubmitCollectionBatchInput,
  UpdateCollectionAreaInput,
  VarianceApprovalInput,
} from './collection';

export {
  createPaymentSchema,
  paymentAllocationSchema,
  paymentDetailSchema,
  paymentIdParamSchema,
  paymentListQuerySchema,
  paymentMethodSchema,
  paymentPreviewSchema,
  paymentReversalReasonCodeSchema,
  paymentStatusSchema,
  paymentSummarySchema,
  reversePaymentSchema,
  verifyPaymentSchema,
} from './payments';
export type {
  CreatePaymentInput,
  PaymentAllocation,
  PaymentDetail,
  PaymentListQuery,
  PaymentPreview,
  PaymentReversalReasonCode,
  PaymentSummary,
  ReversePaymentInput,
  VerifyPaymentInput,
} from './payments';

export { searchProviderSchema, subscriberSearchQuerySchema } from './search';
export type { SearchProvider, SubscriberSearchQuery } from './search';

export {
  dashboardSchema,
  reportExportFormatSchema,
  reportExportSchema,
  reportFormatSchema,
  reportQuerySchema,
  reportResultSchema,
  reportRowSchema,
  reportTypeSchema,
  receiptIdParamSchema,
} from './reports';
export type {
  Dashboard,
  ReportExportFormat,
  ReportExportRequest,
  ReportFormat,
  ReportQuery,
  ReportResult,
  ReportType,
} from './reports';

export { backupHistorySchema, backupIdParamSchema } from './backup';
export type { BackupHistory } from './backup';

export {
  agingBucketSchema,
  agingSummarySchema,
  receivableListQuerySchema,
  receivableSummarySchema,
  reconnectionCompleteSchema,
  reconnectionIdParamSchema,
  reconnectionRecordSchema,
  reconnectionRequestSchema,
  reconnectionScheduleSchema,
  suspensionCandidateQuerySchema,
  suspensionCandidateSchema,
  suspensionRecordSchema,
  suspendServiceSchema,
} from './receivables';
export type {
  AgingBucket,
  AgingSummary,
  ReceivableListQuery,
  ReceivableSummary,
  ReconnectionCompleteInput,
  ReconnectionRecord,
  ReconnectionRequestInput,
  ReconnectionScheduleInput,
  SuspensionCandidate,
  SuspensionCandidateQuery,
  SuspensionRecord,
  SuspendServiceInput,
} from './receivables';

export {
  ADJUSTMENT_REASON_CODES,
  adjustmentReasonCodeSchema,
  applyPenaltiesSchema,
  billingCycleStatusSchema,
  billingCycleSummarySchema,
  billingDashboardSchema,
  billingMonthSchema,
  billingPreviewLineSchema,
  billingPreviewSchema,
  billingRunResultSchema,
  billingSkipSchema,
  createAdjustmentSchema,
  displayInvoiceStatusSchema,
  finalizeInvoiceSchema,
  generateBillingSchema,
  invoiceDetailSchema,
  invoiceIdParamSchema,
  invoiceItemSchema,
  invoiceListQuerySchema,
  invoiceSummarySchema,
  ledgerEntrySchema,
  ledgerQuerySchema,
  ledgerStatementSchema,
  storedInvoiceStatusSchema,
  voidInvoiceSchema,
} from './billing';
export type {
  ApplyPenaltiesInput,
  BillingCycleSummary,
  BillingDashboard,
  BillingPreview,
  BillingPreviewLine,
  BillingRunResult,
  BillingSkip,
  CreateAdjustmentInput,
  DisplayInvoiceStatusValue,
  FinalizeInvoiceInput,
  GenerateBillingInput,
  InvoiceDetail,
  InvoiceItem,
  InvoiceListQuery,
  InvoiceSummary,
  LedgerEntry,
  LedgerQuery,
  LedgerStatement,
  StoredInvoiceStatusValue,
  VoidInvoiceInput,
} from './billing';
