import type { Permission } from '@bcis/shared';
import { Footer } from '@renderer/components/footer';
import { Sidebar } from '@renderer/components/sidebar';
import { TopBar } from '@renderer/components/top-bar';
import { Alert } from '@renderer/components/ui/feedback';
import { MyAccountPanel } from '@renderer/features/account/my-account-panel';
import { AuditLogScreen } from '@renderer/features/audit/audit-log-screen';
import { AuthProvider, useAuth } from '@renderer/features/auth/auth-context';
import { ChangePasswordScreen } from '@renderer/features/auth/change-password-screen';
import { LockScreen } from '@renderer/features/auth/lock-screen';
import { LoginScreen } from '@renderer/features/auth/login-screen';
import { PlansScreen } from '@renderer/features/plans/plans-screen';
import { BillingDashboardScreen } from '@renderer/features/billing/billing-dashboard-screen';
import { GenerateBillingScreen } from '@renderer/features/billing/generate-billing-screen';
import { InvoiceDetailScreen } from '@renderer/features/billing/invoice-detail-screen';
import { InvoiceListScreen } from '@renderer/features/billing/invoice-list-screen';
import { SettingsScreen } from '@renderer/features/settings/settings-screen';
import { NewSubscriberScreen } from '@renderer/features/subscribers/new-subscriber-screen';
import { ServiceAccountListScreen } from '@renderer/features/subscribers/service-account-list-screen';
import { SubscriberListScreen } from '@renderer/features/subscribers/subscriber-list-screen';
import { SubscriberProfileScreen } from '@renderer/features/subscribers/subscriber-profile-screen';
import { SystemHealthPanel } from '@renderer/features/system-health/system-health-panel';
import { UsersScreen } from '@renderer/features/users/users-screen';
import { ReceivablesScreen } from '@renderer/features/receivables/receivables-screen';
import { ReportsScreen } from '@renderer/features/reports/reports-screen';
import { ReceivePaymentScreen } from '@renderer/features/payments/receive-payment-screen';
import { PaymentHistoryScreen } from '@renderer/features/payments/payment-history-screen';
import { GcashVerificationScreen } from '@renderer/features/payments/gcash-verification-screen';
import { CollectorsScreen } from '@renderer/features/collections/collectors-screen';
import { AreasRoutesScreen } from '@renderer/features/collections/areas-routes-screen';
import { CollectionBatchesScreen } from '@renderer/features/collections/collection-batches-screen';
import { RemittanceScreen } from '@renderer/features/collections/remittance-screen';
import { BackupScreen } from '@renderer/features/admin/backup-screen';
import { SCREEN_PERMISSIONS, SCREEN_TITLES, type ScreenKey } from '@renderer/lib/navigation';
import type { JSX } from 'react';
import { useCallback, useState } from 'react';

/**
 * Application root.
 *
 * ── THE GATE ────────────────────────────────────────────────────────────────
 * Four states, checked in this order, and nothing else renders until one is
 * chosen: still loading, not signed in, session locked, or a password change is
 * required. Rendering the shell underneath a sign-in screen and covering it
 * with a modal is how a screen ends up briefly showing another user's data.
 *
 * ── ROUTING ─────────────────────────────────────────────────────────────────
 * Phase 1 deferred the router because routes and permission guards are one piece
 * of work; Phase 2 added both. Phase 3 needs one thing more than a keyed screen:
 * a subscriber profile is reached FROM a list, so the navigation state carries
 * the subscriber being viewed. It is still not a URL router — a desktop
 * application with one window has no addresses to bookmark and no deep links to
 * validate — but it is no longer a single opaque key either.
 */
export function App(): JSX.Element {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}

function AppGate(): JSX.Element {
  const { state, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Starting…</p>
      </div>
    );
  }

  if (!state.authenticated || state.user === null) {
    return <LoginScreen />;
  }

  if (state.locked) {
    return <LockScreen />;
  }

  if (state.user.mustChangePassword) {
    return <ChangePasswordScreen forced />;
  }

  return <AppShell />;
}

interface NavigationState {
  readonly screen: ScreenKey;
  /** Set only while viewing a subscriber profile. */
  readonly subscriberId: number | null;
  /** Set only while viewing an invoice. */
  readonly invoiceId: number | null;
}

type Navigate = (next: Partial<NavigationState>) => void;

function AppShell(): JSX.Element {
  const [navigation, setNavigation] = useState<NavigationState>({
    screen: 'system-health',
    subscriberId: null,
    invoiceId: null,
  });

  const navigate = useCallback<Navigate>((next) => {
    setNavigation((current) => ({ ...current, ...next }));
  }, []);

  return (
    /*
     * The window is a fixed-height row that never scrolls: sidebar beside a
     * column of header, scroll container, and footer. Only `main` scrolls, so
     * the header and footer hold their position and nothing overlaps anything
     * else — which is also why the footer needs no padding compensation.
     * `overflow-hidden` is what keeps a wide table from scrolling the whole
     * window sideways instead of its own container.
     */
    <div className="flex h-full overflow-hidden">
      <Sidebar
        active={navigation.screen}
        onSelect={(screen) => {
          // Leaving a detail screen for a sidebar destination also drops the
          // ids, so returning to a list does not silently reopen the last one.
          navigate({ screen, subscriberId: null, invoiceId: null });
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar title={SCREEN_TITLES[navigation.screen]} />

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <ScreenOutlet navigation={navigation} navigate={navigate} />
        </main>

        <Footer />
      </div>
    </div>
  );
}

/**
 * Resolve a screen, refusing one the user is not permitted to use.
 *
 * The refusal is deliberate even though the sidebar already hides these: a role
 * can change while a screen is open, and the renderer's copy of the permission
 * list is a snapshot. The API would refuse the requests anyway — this only
 * avoids presenting an empty table that looks like "no data".
 */
function ScreenOutlet({
  navigation,
  navigate,
}: {
  readonly navigation: NavigationState;
  readonly navigate: Navigate;
}): JSX.Element {
  const { can } = useAuth();
  const { screen } = navigation;
  const permission: Permission | null = SCREEN_PERMISSIONS[screen];

  if (permission !== null && !can(permission)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="danger" title={`You do not have access to ${SCREEN_TITLES[screen]}`}>
          <p>
            This screen needs the <span className="font-mono">{permission}</span> permission. If
            your role changed during this session, sign out and back in.
          </p>
        </Alert>
      </div>
    );
  }

  switch (screen) {
    case 'system-health':
      return <SystemHealthPanel />;
    case 'my-account':
      return <MyAccountPanel />;
    case 'users':
      return <UsersScreen />;
    case 'audit-log':
      return <AuditLogScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'subscribers':
      return (
        <SubscriberListScreen
          onOpen={(subscriberId) => {
            navigate({ screen: 'subscriber-detail', subscriberId });
          }}
          onNew={() => {
            navigate({ screen: 'new-subscriber', subscriberId: null });
          }}
        />
      );
    case 'new-subscriber':
      return (
        <NewSubscriberScreen
          onCreated={(subscriberId) => {
            navigate({ screen: 'subscriber-detail', subscriberId });
          }}
          onCancel={() => {
            navigate({ screen: 'subscribers', subscriberId: null });
          }}
        />
      );
    case 'subscriber-detail':
      return navigation.subscriberId === null ? (
        <Alert tone="warning" title="No subscriber selected">
          Open a subscriber from the list to see their profile.
        </Alert>
      ) : (
        <SubscriberProfileScreen
          subscriberId={navigation.subscriberId}
          onBack={() => {
            navigate({ screen: 'subscribers', subscriberId: null });
          }}
          onOpenInvoice={(invoiceId) => {
            navigate({ screen: 'invoice-detail', invoiceId });
          }}
        />
      );
    case 'service-accounts':
      return (
        <ServiceAccountListScreen
          onOpenSubscriber={(subscriberId) => {
            navigate({ screen: 'subscriber-detail', subscriberId });
          }}
        />
      );
    case 'plans':
      return <PlansScreen />;
    case 'billing-dashboard':
      return <BillingDashboardScreen />;
    case 'generate-billing':
      return (
        <GenerateBillingScreen
          onGenerated={() => {
            navigate({ screen: 'invoices', subscriberId: null, invoiceId: null });
          }}
        />
      );
    case 'invoices':
      return (
        <InvoiceListScreen
          onOpen={(invoiceId) => {
            navigate({ screen: 'invoice-detail', invoiceId });
          }}
        />
      );
    case 'invoice-detail':
      return navigation.invoiceId === null ? (
        <Alert tone="warning" title="No invoice selected">
          Open an invoice from the list to see its detail.
        </Alert>
      ) : (
        <InvoiceDetailScreen
          invoiceId={navigation.invoiceId}
          onBack={() => {
            navigate({ screen: 'invoices', invoiceId: null });
          }}
        />
      );
    case 'receivables':
      return <ReceivablesScreen />;
    case 'reports':
      return <ReportsScreen />;
    case 'receive-payment':
      return <ReceivePaymentScreen />;
    case 'payment-history':
      return <PaymentHistoryScreen />;
    case 'gcash-verification':
      return <GcashVerificationScreen />;
    case 'collectors':
      return <CollectorsScreen />;
    case 'collection-areas':
      return <AreasRoutesScreen />;
    case 'collection-batches':
      return <CollectionBatchesScreen />;
    case 'remittance':
      return <RemittanceScreen />;
    case 'backup':
      return <BackupScreen />;
  }
}
