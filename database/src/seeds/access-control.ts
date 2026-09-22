import {
  ALL_PERMISSIONS,
  ALL_ROLE_CODES,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_LABELS,
  type Permission,
  type RoleCode,
} from '@bcis/shared';
import type { Pool } from 'pg';

/**
 * Access-control master data.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A SQL SEED FILE ──────────────────────────
 * The permission list is already defined in `@bcis/shared` and consumed by the
 * API guard. A second copy in SQL would drift the first time someone adds a
 * permission, and the failure would be silent: the code would check a
 * permission the database had never heard of, and every request would be
 * denied. Seeding from the same constant the API uses makes that impossible.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 * Re-running is safe and re-asserts the default grant set, so a demo database
 * can always be returned to a known state (decision A16). Settings are the
 * exception: they are seeded with DO NOTHING so an operator's edits survive a
 * re-seed.
 */

export interface AccessControlSeedResult {
  readonly permissions: number;
  readonly roles: number;
  readonly rolePermissions: number;
  readonly settings: number;
}

/** One-line description per role, shown in the role editor. */
const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  OWNER: 'Full access, including configuration, users, audit, and backup/restore.',
  ADMINISTRATOR: 'Operational administration: subscribers, plans, billing, collections.',
  CASHIER: 'Receives payments, issues receipts, processes approved GCash.',
  COLLECTION_SUPERVISOR: 'Areas, routes, collectors, batches, remittance, reconciliation.',
  ACCOUNTING_AUDITOR: 'Reports, adjustments and reversals review, receivables, audit.',
  TECHNICIAN: 'Service account and suspension/reconnection information.',
  READ_ONLY_VIEWER: 'Dashboards and reports only. No mutation permissions.',
};

interface SettingSeed {
  readonly key: string;
  readonly value: string;
  readonly valueType: 'string' | 'integer' | 'boolean' | 'decimal' | 'json';
  readonly category: string;
  readonly description: string;
}

/**
 * Default configuration values.
 *
 * These are the settings later phases read instead of hardcoding a policy:
 * the grace period before a penalty (A4), the suspension thresholds (A6), and
 * the reconnection fee (A7). They are seeded now so those phases read a real
 * row rather than inventing a default at the call site.
 */
export const DEFAULT_SETTINGS: readonly SettingSeed[] = [
  {
    key: 'company.name',
    value: 'Bukidnon Cable and Internet Services',
    valueType: 'string',
    category: 'company',
    description: 'Legal name printed on receipts and statements.',
  },
  {
    key: 'company.currency',
    value: 'PHP',
    valueType: 'string',
    category: 'company',
    description: 'Reporting currency. Amounts are always stored as integer centavos.',
  },
  {
    key: 'billing.grace_period_days',
    value: '5',
    valueType: 'integer',
    category: 'billing',
    description: 'Days after the due date before a penalty may be applied.',
  },
  {
    key: 'billing.penalty_enabled',
    value: 'false',
    valueType: 'boolean',
    category: 'billing',
    description: 'Whether a late penalty is applied once the grace period passes.',
  },
  {
    key: 'billing.penalty_rate_basis_points',
    value: '0',
    valueType: 'integer',
    category: 'billing',
    description: 'Late penalty rate in basis points (100 = 1%). Applied once, never compounding.',
  },
  {
    key: 'receivables.suspension_months_unpaid',
    value: '3',
    valueType: 'integer',
    category: 'receivables',
    description: 'Months unpaid before an account appears as a suspension candidate.',
  },
  {
    key: 'receivables.suspension_days_overdue',
    value: '60',
    valueType: 'integer',
    category: 'receivables',
    description: 'Days overdue before an account appears as a suspension candidate.',
  },
  {
    key: 'receivables.minimum_reconnection_payment_centavos',
    value: '0',
    valueType: 'integer',
    category: 'receivables',
    description: 'Minimum payment required before reconnection, in centavos.',
  },
];

function titleCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/** The first segment of a permission code is its category, e.g. `payment.reverse`. */
export function permissionCategory(code: string): string {
  return code.split('.')[0] ?? 'general';
}

/** Human-readable label derived from the code, so the list never needs hand-maintaining. */
export function permissionDescription(code: string): string {
  const segments = code.split('.');
  const head = segments[0] ?? code;
  const tail = segments.slice(1).join(' ').replaceAll('_', ' ');
  return `${titleCase(head)}: ${titleCase(tail)}`;
}

/** Reads a single-row `RETURNING id` result, failing loudly if the row is missing. */
function requiredId(rows: readonly { id: number }[], context: string): number {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Seed failed: ${context} returned no id.`);
  }
  return row.id;
}

/**
 * Seed permissions, roles, their grants, and default settings.
 *
 * Runs in one transaction: a half-seeded access-control table would leave the
 * API checking permissions that do not exist.
 */
export async function seedAccessControl(pool: Pool): Promise<AccessControlSeedResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const permissionIds = new Map<Permission, number>();
    for (const code of ALL_PERMISSIONS) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO permissions (code, category, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE
           SET category = EXCLUDED.category,
               description = EXCLUDED.description
         RETURNING id`,
        [code, permissionCategory(code), permissionDescription(code)],
      );
      permissionIds.set(code, requiredId(rows, `permission ${code}`));
    }

    const roleIds = new Map<RoleCode, number>();
    for (const code of ALL_ROLE_CODES) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO roles (code, name, description, is_system)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description
         RETURNING id`,
        [code, ROLE_LABELS[code], ROLE_DESCRIPTIONS[code]],
      );
      roleIds.set(code, requiredId(rows, `role ${code}`));
    }

    // Re-assert the default grants. This is a delete-then-insert rather than a
    // merge so that a permission removed from DEFAULT_ROLE_PERMISSIONS in code
    // is actually removed from the database, which is what makes the seeded
    // state a function of the source rather than of its history.
    let rolePermissions = 0;
    for (const code of ALL_ROLE_CODES) {
      const roleId = roleIds.get(code);
      if (roleId === undefined) continue;

      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

      // OWNER is intentionally not listed in DEFAULT_ROLE_PERMISSIONS: it holds
      // every permission, including ones added in later phases, without the
      // list having to be maintained.
      const grants: readonly Permission[] =
        code === 'OWNER' ? ALL_PERMISSIONS : DEFAULT_ROLE_PERMISSIONS[code];

      for (const permission of grants) {
        const permissionId = permissionIds.get(permission);
        if (permissionId === undefined) continue;
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [roleId, permissionId],
        );
        rolePermissions += 1;
      }
    }

    for (const setting of DEFAULT_SETTINGS) {
      await client.query(
        `INSERT INTO application_settings (key, value, value_type, category, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO NOTHING`,
        [setting.key, setting.value, setting.valueType, setting.category, setting.description],
      );
    }

    await client.query('COMMIT');

    return {
      permissions: ALL_PERMISSIONS.length,
      roles: ALL_ROLE_CODES.length,
      rolePermissions,
      settings: DEFAULT_SETTINGS.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
