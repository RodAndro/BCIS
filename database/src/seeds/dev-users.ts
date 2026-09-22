import { hashPassword } from '@bcis/security';
import { ROLE_CODES, type RoleCode } from '@bcis/shared';
import type { Pool } from 'pg';

/**
 * Development accounts (§32 requires synthetic data only).
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * These accounts exist so a developer or an examiner can sign in and exercise
 * the workflow. They are created by an explicit, documented command
 * (`pnpm db:seed`) and never by a migration, so a production database can be
 * migrated without silently acquiring a known-password administrator.
 *
 * The seed refuses to run when `NODE_ENV=production`. That guard is the reason
 * the default passwords below are safe to keep in source: they are dev-only
 * credentials for a synthetic dataset, and the process will not create them in
 * production. Real deployments create their first Owner through a documented
 * manual step in Phase 9.
 */

export type DevUserStatus = 'ACTIVE' | 'DISABLED';

interface DevUserSpec {
  /** Environment variable holding the password, with a documented default. */
  readonly passwordEnv: string;
  readonly defaultPassword: string;
  readonly username: string;
  readonly fullName: string;
  readonly roleCode: RoleCode;
  readonly status: DevUserStatus;
  readonly purpose: string;
}

/**
 * The four demo identities.
 *
 * Chosen to cover the states the authorization tests and the manual checklist
 * need without creating throwaway accounts: a full-access Owner, a restricted
 * Cashier (the AT-10 subject), a read-and-audit role, and one disabled account
 * so "inactive users cannot sign in" is demonstrable without first mutating
 * data.
 */
export const DEV_USERS: readonly DevUserSpec[] = [
  {
    passwordEnv: 'SEED_ADMIN_PASSWORD',
    defaultPassword: 'Admin@BCIS2026',
    username: 'admin',
    fullName: 'System Owner',
    roleCode: ROLE_CODES.OWNER,
    status: 'ACTIVE',
    purpose: 'Owner / Super Admin',
  },
  {
    passwordEnv: 'SEED_CASHIER_PASSWORD',
    defaultPassword: 'Cashier@BCIS2026',
    username: 'cashier',
    fullName: 'Front Desk Cashier',
    roleCode: ROLE_CODES.CASHIER,
    status: 'ACTIVE',
    purpose: 'Cashier — used to prove a restricted role is refused admin endpoints',
  },
  {
    passwordEnv: 'SEED_AUDITOR_PASSWORD',
    defaultPassword: 'Auditor@BCIS2026',
    username: 'auditor',
    fullName: 'Accounting Auditor',
    roleCode: ROLE_CODES.ACCOUNTING_AUDITOR,
    status: 'ACTIVE',
    purpose: 'Accounting / Auditor — read-heavy role with audit access',
  },
  {
    passwordEnv: 'SEED_ADMINISTRATOR_PASSWORD',
    defaultPassword: 'Admin2@BCIS2026',
    username: 'administrator',
    fullName: 'Operations Administrator',
    roleCode: ROLE_CODES.ADMINISTRATOR,
    status: 'ACTIVE',
    purpose: 'Administrator — the operational role that owns subscribers and plans',
  },
  {
    passwordEnv: 'SEED_SUPERVISOR_PASSWORD',
    defaultPassword: 'Supervisor@BCIS2026',
    username: 'supervisor',
    fullName: 'Collection Supervisor',
    roleCode: ROLE_CODES.COLLECTION_SUPERVISOR,
    status: 'ACTIVE',
    purpose: 'Collection Supervisor — stands in as field staff for the demo routes',
  },
  {
    passwordEnv: 'SEED_TECHNICIAN_PASSWORD',
    defaultPassword: 'Technician@BCIS2026',
    username: 'technician.disabled',
    fullName: 'Field Technician (disabled)',
    roleCode: ROLE_CODES.TECHNICIAN,
    status: 'DISABLED',
    purpose: 'Disabled account — proves an inactive user cannot sign in',
  },
];

export interface SeededDevUser {
  readonly username: string;
  readonly role: RoleCode;
  readonly status: DevUserStatus;
}

export interface DevUserSeedResult {
  readonly users: readonly SeededDevUser[];
  /** True when passwords came from the documented defaults rather than the environment. */
  readonly usedDefaultPasswords: boolean;
}

/**
 * Seed the development accounts.
 *
 * @throws when `NODE_ENV` is `production`.
 */
export async function seedDevUsers(pool: Pool): Promise<DevUserSeedResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed development accounts with NODE_ENV=production. ' +
        'These accounts have documented passwords and must never exist in production.',
    );
  }

  const seeded: SeededDevUser[] = [];
  let usedDefaultPasswords = false;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const spec of DEV_USERS) {
      const fromEnvironment = process.env[spec.passwordEnv];
      const password =
        fromEnvironment !== undefined && fromEnvironment.length > 0
          ? fromEnvironment
          : spec.defaultPassword;
      if (fromEnvironment === undefined || fromEnvironment.length === 0) {
        usedDefaultPasswords = true;
      }

      const passwordHash = await hashPassword(password);

      // Re-seeding restores the documented password and clears any lockout, so
      // a demo database can always be returned to a known state. That is
      // acceptable precisely because this runs against development data only.
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO users
           (username, password_hash, full_name, status, must_change_password, failed_login_count)
         VALUES ($1, $2, $3, $4, false, 0)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               full_name = EXCLUDED.full_name,
               status = EXCLUDED.status,
               must_change_password = false,
               failed_login_count = 0,
               locked_until = NULL,
               updated_at = now()
         RETURNING id`,
        [spec.username, passwordHash, spec.fullName, spec.status],
      );

      const userId = rows[0]?.id;
      if (userId === undefined) {
        throw new Error(`Seed failed: user ${spec.username} returned no id.`);
      }

      // A user may hold several roles; the demo set holds exactly one each, so
      // replacing is correct here and keeps re-seeding deterministic.
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, r.id FROM roles r WHERE r.code = $2
         ON CONFLICT DO NOTHING`,
        [userId, spec.roleCode],
      );

      seeded.push({ username: spec.username, role: spec.roleCode, status: spec.status });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { users: seeded, usedDefaultPasswords };
}

/**
 * The password a given demo account will receive, for the seed summary.
 *
 * Returned only so the CLI can tell the operator which environment variable
 * overrides it. The password itself is deliberately not printed.
 */
export function passwordSourceFor(spec: DevUserSpec): string {
  const fromEnvironment = process.env[spec.passwordEnv];
  return fromEnvironment !== undefined && fromEnvironment.length > 0
    ? `$${spec.passwordEnv}`
    : 'documented default';
}

export type { DevUserSpec };
