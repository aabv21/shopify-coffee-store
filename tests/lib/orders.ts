import { readFileSync } from 'node:fs';
import type { ShopifyOrderPayload } from '../../src/nodes/types.ts';

export const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/orders/${n}.json`, 'utf8')) as ShopifyOrderPayload;
