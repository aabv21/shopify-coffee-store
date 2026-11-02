import { describe, expect, it } from 'vitest';
import {
  assertNoLiveCredential,
  checksFor,
  guardedCredentialIds,
  isDuplicateIntakeResponse,
  isFreshIntakeResponse,
  isLoadConfigResponse,
} from '../../scripts/check-dev-response.ts';
import { CREDENTIALS } from '../../scripts/lib/manifest.ts';

const EXPECTED_CONFIG = {
  owner_email: 'owner@example.com',
  google: { orders_sheet_id: 'REPLACE_ME', orders_tab: 'Orders' },
  shopify: { store: 'replace-me', api_version: '2026-10' },
  low_stock_threshold: 5,
  guide_delay_minutes: 60,
};

const FRESH_ORDER = {
  order_id: '7000000001',
  order_number: '#T1001',
  created_at: '2026-11-04T09:05:00-05:00',
  email: 'ana.torres@example.com',
  first_name: 'Ana',
  customer_name: 'Ana Torres',
  city: 'Medellín',
  currency: 'COP',
  subtotal: 38000,
  shipping: 12000,
  total: 50000,
  free_shipping: false,
  lines: [
    { variant_id: '3001', variant_gid: 'gid://shopify/ProductVariant/3001', product_title: 'Sierra Nevada', variant_title: '250 g', sku: 'NBC-SNV-250', quantity: 1 },
  ],
  variant_gids: ['gid://shopify/ProductVariant/3001'],
};

describe('guardedCredentialIds', () => {
  it('derives exactly the Google, Gmail, and Shopify credential ids from the manifest, by type', () => {
    expect(guardedCredentialIds().sort()).toEqual(['nbcCredGSheets01', 'nbcCredGmail0001', 'nbcCredShopify01'].sort());
  });

  it('never includes the Postgres or dev-harness-token credentials', () => {
    const guarded = new Set(guardedCredentialIds());
    expect(guarded.has('nbcCredAppDb0001')).toBe(false);
    expect(guarded.has('nbcCredDevToken1')).toBe(false);
  });

  it('tracks the manifest: every guarded id really is Shopify, Google, or Gmail typed', () => {
    const byId = new Map(CREDENTIALS.map((c) => [c.id, c.type]));
    for (const id of guardedCredentialIds()) {
      expect(byId.get(id)).toMatch(/shopify|google|gmail/i);
    }
  });
});

describe('assertNoLiveCredential', () => {
  it('does nothing when no guarded credential exists', () => {
    expect(() => assertNoLiveCredential(new Set())).not.toThrow();
    expect(() => assertNoLiveCredential(new Set(['nbcCredAppDb0001', 'nbcCredDevToken1']))).not.toThrow();
  });

  it('refuses when the Shopify credential exists, naming it', () => {
    expect(() => assertNoLiveCredential(new Set(['nbcCredShopify01']))).toThrow(/Shopify Admin \(nbcCredShopify01\)/);
  });

  it('refuses when the Gmail credential exists, naming it', () => {
    expect(() => assertNoLiveCredential(new Set(['nbcCredGmail0001']))).toThrow(/Gmail \(nbcCredGmail0001\)/);
  });

  it('refuses when the Google Sheets credential exists, naming it', () => {
    expect(() => assertNoLiveCredential(new Set(['nbcCredGSheets01']))).toThrow(/Google Sheets \(nbcCredGSheets01\)/);
  });

  it('names every guarded credential present, not just the first', () => {
    expect(() => assertNoLiveCredential(new Set(['nbcCredShopify01', 'nbcCredGmail0001']))).toThrow(/Shopify Admin.*Gmail|Gmail.*Shopify Admin/);
  });
});

describe('isLoadConfigResponse', () => {
  it('accepts the mounted config as load-config returns it', () => {
    expect(isLoadConfigResponse({ config: EXPECTED_CONFIG })).toBe(true);
  });
  it('rejects a response with an extra key', () => {
    expect(isLoadConfigResponse({ config: EXPECTED_CONFIG, extra: 1 })).toBe(false);
  });
  it('rejects a different config value', () => {
    expect(isLoadConfigResponse({ config: { ...EXPECTED_CONFIG, owner_email: 'other@example.com' } })).toBe(false);
  });
  it('rejects null and non-objects', () => {
    expect(isLoadConfigResponse(null)).toBe(false);
    expect(isLoadConfigResponse('x')).toBe(false);
  });
});

describe('isFreshIntakeResponse', () => {
  it('accepts the exact shape a fresh call against an empty database produces', () => {
    expect(isFreshIntakeResponse({ order: FRESH_ORDER, config: EXPECTED_CONFIG })).toBe(true);
  });
  it('rejects a mismatched order id', () => {
    expect(isFreshIntakeResponse({ order: { ...FRESH_ORDER, order_id: '999' }, config: EXPECTED_CONFIG })).toBe(false);
  });
  it('rejects a mismatched order number', () => {
    expect(isFreshIntakeResponse({ order: { ...FRESH_ORDER, order_number: '#T9999' }, config: EXPECTED_CONFIG })).toBe(false);
  });
  it('rejects a mismatched config', () => {
    expect(isFreshIntakeResponse({ order: FRESH_ORDER, config: { ...EXPECTED_CONFIG, low_stock_threshold: 1 } })).toBe(false);
  });
  it('rejects an extra key', () => {
    expect(isFreshIntakeResponse({ order: FRESH_ORDER, config: EXPECTED_CONFIG, extra: 1 })).toBe(false);
  });
  it('rejects the duplicate shape', () => {
    expect(isFreshIntakeResponse({ success: true })).toBe(false);
  });
  it('rejects null, arrays, and primitives', () => {
    expect(isFreshIntakeResponse(null)).toBe(false);
    expect(isFreshIntakeResponse([])).toBe(false);
    expect(isFreshIntakeResponse('x')).toBe(false);
  });
});

describe('checksFor', () => {
  const intakeCheck = (fresh: boolean): { target: string; input: unknown; isExpected: (result: unknown) => boolean } => {
    const check = checksFor({ fresh }).find((c) => c.target === 'intake-order');
    if (!check) throw new Error('intake-order check missing from checksFor()');
    return check;
  };

  it('with fresh: true, accepts only the fresh shape — a duplicate response fails the check', () => {
    const { isExpected } = intakeCheck(true);
    expect(isExpected({ order: FRESH_ORDER, config: EXPECTED_CONFIG })).toBe(true);
    expect(isExpected({ success: true })).toBe(false);
  });

  it('with fresh: false, accepts either shape, for a local re-run against a stack that already recorded the fixture order', () => {
    const { isExpected } = intakeCheck(false);
    expect(isExpected({ order: FRESH_ORDER, config: EXPECTED_CONFIG })).toBe(true);
    expect(isExpected({ success: true })).toBe(true);
  });

  it('the flag has no effect on the load-config check', () => {
    const loadConfigFresh = checksFor({ fresh: true }).find((c) => c.target === 'load-config');
    const loadConfigNotFresh = checksFor({ fresh: false }).find((c) => c.target === 'load-config');
    expect(loadConfigFresh?.isExpected({ config: EXPECTED_CONFIG })).toBe(true);
    expect(loadConfigNotFresh?.isExpected({ config: EXPECTED_CONFIG })).toBe(true);
  });
});

describe('isDuplicateIntakeResponse', () => {
  it('accepts the exact shape Record order reports for an already-seen order', () => {
    expect(isDuplicateIntakeResponse({ success: true })).toBe(true);
  });
  it('rejects success: false', () => {
    expect(isDuplicateIntakeResponse({ success: false })).toBe(false);
  });
  it('rejects an extra key', () => {
    expect(isDuplicateIntakeResponse({ success: true, order_id: '1' })).toBe(false);
  });
  it('rejects the fresh shape', () => {
    expect(isDuplicateIntakeResponse({ order: FRESH_ORDER, config: EXPECTED_CONFIG })).toBe(false);
  });
  it('rejects null, arrays, and primitives', () => {
    expect(isDuplicateIntakeResponse(null)).toBe(false);
    expect(isDuplicateIntakeResponse([])).toBe(false);
    expect(isDuplicateIntakeResponse('x')).toBe(false);
  });
});
