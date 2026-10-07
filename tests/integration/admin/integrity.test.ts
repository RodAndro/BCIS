import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BILLING_MONTH,
  bootBilling,
  call,
  makeBillingAccount,
  type BillingHarness,
} from '../helpers/billing';

/**
 * Admin integrity checks.
 *
 * The point of these checks is that they are computed independently of the
 * screens that display the numbers: if AR aging and the stored invoice
 * balances ever disagree, an operator is looking at two different stories and
 * the check says so.
 */

let harness: BillingHarness;

beforeAll(async () => {
  harness = await bootBilling();
  await makeBillingAccount(harness, 'Integrity Customer');
  const generated = await call(harness.app, 'POST', '/billing/generate', harness.admin, {
    month: BILLING_MONTH,
    dryRun: false,
  });
  expect(generated.status).toBe(200);
});

afterAll(async () => {
  await harness.app.close();
  await harness.testDatabase.close();
});

describe('integrity checks', () => {
  it('runs clean and reconciles AR aging with outstanding balances', async () => {
    const response = await call<{
      ok: boolean;
      checks: Array<{ name: string; ok: boolean; failures: number }>;
    }>(harness.app, 'GET', '/integrity', harness.auditor);

    expect(response.status).toBe(200);
    expect(response.data.ok).toBe(true);
    expect(response.data.checks.map((check) => check.name)).toContain(
      'aging_reconciles_with_outstanding',
    );
    expect(response.data.checks.every((check) => check.ok)).toBe(true);
  });

  it('refuses a role without integrity.check.run', async () => {
    const response = await call(harness.app, 'GET', '/integrity', harness.cashier);
    expect(response.status).toBe(403);
  });
});
