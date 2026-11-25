// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { freeShippingProgress } from '../../src/theme/free-shipping.ts';
import { renderBar } from '../lib/theme-render.ts';

describe('the bar rendered on the server', () => {
  it.each([0, 3_800_000, 7_200_000, 11_999_900, 12_000_000, 15_200_000])('the first paint at %i cents matches freeShippingProgress', async (total) => {
    const template = document.createElement('template');
    template.innerHTML = await renderBar(total);
    const bar = template.content.querySelector<HTMLElement>('.free-shipping-bar')!;
    const meter = template.content.querySelector<HTMLElement>('[role="progressbar"]')!;
    const fill = meter.querySelector<HTMLElement>('[style*="--free-shipping-progress"]')!;
    const expected = freeShippingProgress(total, Number(bar.dataset.thresholdCents))!;

    expect(bar.dataset.state).toBe(expected.reached ? 'reached' : 'remaining');
    expect(Number(meter.getAttribute('aria-valuenow'))).toBe(expected.percent);
    expect(Number(/--free-shipping-progress:\s*([\d.]+)/.exec(fill.getAttribute('style') ?? '')?.[1])).toBeCloseTo(expected.percent / 100, 10);
  });
});
