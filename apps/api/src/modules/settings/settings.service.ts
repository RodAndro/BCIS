import { NotFoundError, ValidationError } from '@bcis/shared';
import { isValidSettingValue, type Setting } from '@bcis/validation';

import type { Db } from '../../shared/database';
import type { ActorContext } from '../../shared/request-context';
import { AUDIT_ACTIONS, AUDIT_ENTITIES } from '../audit/audit.actions';
import { writeAudit } from '../audit/audit.service';
import * as repository from './settings.repository';
import type { SettingRow } from './settings.repository';

/**
 * Application settings.
 *
 * ── WHY UPDATES ARE AUDITED ─────────────────────────────────────────────────
 * A settings row changes the behaviour of a later phase: the grace period
 * before a penalty, the suspension threshold. Those are commercial decisions
 * with financial consequences, so "who changed this and when" must be
 * answerable without going through a code review.
 */

function toSetting(row: SettingRow): Setting {
  return {
    key: row.key,
    value: row.value,
    valueType: row.valueType,
    category: row.category,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSettings(db: Db): Promise<readonly Setting[]> {
  const rows = await repository.listSettings(db);
  return rows.map(toSetting);
}

export async function updateSetting(
  db: Db,
  key: string,
  value: string,
  actor: ActorContext,
): Promise<Setting> {
  const existing = await repository.findSettingByKey(db, key);
  if (existing === null) {
    throw new NotFoundError('That setting does not exist.');
  }

  // The type is the row's own declaration, not the client's, so a caller cannot
  // reclassify a setting by sending a different valueType.
  if (!isValidSettingValue(value, existing.valueType)) {
    throw new ValidationError(`This setting expects a ${existing.valueType} value.`, {
      field: 'value',
      expected: existing.valueType,
    });
  }

  await db.transaction(async (tx) => {
    await repository.updateSettingValue(tx, key, value, actor.userId);

    await writeAudit(tx, {
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      entityType: AUDIT_ENTITIES.SETTING,
      entityId: key,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ip: actor.ip,
      oldValues: { value: existing.value },
      newValues: { value },
    });
  });

  const updated = await repository.findSettingByKey(db, key);
  if (updated === null) {
    throw new NotFoundError('That setting does not exist.');
  }
  return toSetting(updated);
}
