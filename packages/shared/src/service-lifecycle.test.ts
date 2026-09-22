import { describe, expect, it } from 'vitest';

import {
  ALLOWED_STATUS_TRANSITIONS,
  SERVICE_ACCOUNT_STATUSES,
  canTransitionServiceStatus,
  eventTypeForTransition,
  isServiceDelivering,
} from './service-lifecycle';

/**
 * Service lifecycle.
 *
 * The rule under test is the one that decides whether a status change is
 * recorded or refused. Getting it wrong is not cosmetic: allowing
 * `CLOSED → ACTIVE` would let an account resume with a number that a customer's
 * history already refers to.
 */

describe('canTransitionServiceStatus', () => {
  it('allows the normal lifecycle', () => {
    expect(canTransitionServiceStatus('PENDING', 'ACTIVE')).toBe(true);
    expect(canTransitionServiceStatus('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionServiceStatus('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionServiceStatus('ACTIVE', 'DISCONNECTED')).toBe(true);
    expect(canTransitionServiceStatus('DISCONNECTED', 'ACTIVE')).toBe(true);
    expect(canTransitionServiceStatus('ACTIVE', 'CLOSED')).toBe(true);
  });

  it('treats CLOSED as terminal', () => {
    expect(ALLOWED_STATUS_TRANSITIONS.CLOSED).toEqual([]);

    for (const status of SERVICE_ACCOUNT_STATUSES) {
      expect(canTransitionServiceStatus('CLOSED', status)).toBe(false);
    }
  });

  it('refuses a transition to the same status', () => {
    // "Change to ACTIVE" on an ACTIVE account is a no-op or a bug, never a
    // state change worth recording.
    for (const status of SERVICE_ACCOUNT_STATUSES) {
      expect(canTransitionServiceStatus(status, status)).toBe(false);
    }
  });

  it('refuses skipping installation', () => {
    // PENDING must go through ACTIVE; there is no direct route to SUSPENDED.
    expect(canTransitionServiceStatus('PENDING', 'SUSPENDED')).toBe(false);
    expect(canTransitionServiceStatus('PENDING', 'DISCONNECTED')).toBe(false);
  });
});

describe('eventTypeForTransition', () => {
  it('names the operation rather than recording a generic change', () => {
    expect(eventTypeForTransition('PENDING', 'ACTIVE')).toBe('ACTIVATED');
    expect(eventTypeForTransition('ACTIVE', 'SUSPENDED')).toBe('SUSPENDED');
    expect(eventTypeForTransition('SUSPENDED', 'ACTIVE')).toBe('RECONNECTED');
    expect(eventTypeForTransition('ACTIVE', 'DISCONNECTED')).toBe('DISCONNECTED');
    expect(eventTypeForTransition('ACTIVE', 'CLOSED')).toBe('CLOSED');
  });

  it('falls back to STATUS_CHANGED for anything unnamed', () => {
    expect(eventTypeForTransition('DISCONNECTED', 'ACTIVE')).toBe('STATUS_CHANGED');
  });
});

describe('isServiceDelivering', () => {
  it('is true only for ACTIVE', () => {
    expect(isServiceDelivering('ACTIVE')).toBe(true);
    expect(isServiceDelivering('PENDING')).toBe(false);
    expect(isServiceDelivering('SUSPENDED')).toBe(false);
    expect(isServiceDelivering('DISCONNECTED')).toBe(false);
    expect(isServiceDelivering('CLOSED')).toBe(false);
  });
});
