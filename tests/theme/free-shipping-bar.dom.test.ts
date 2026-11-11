// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/theme/free-shipping-bar.ts';
import { renderBar } from '../lib/theme-render.ts';

const CART_EVENT = 'shopify:cart:lines-update';

const cartResponse = (totalCents: number) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total_price: totalCents }) });
const stubFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const ticks = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Parsed inert, then inserted whole, as a browser upgrades the server's markup: the element
// connects with its children already in place.
const mount = (html: string) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  document.body.append(template.content);
};
const bar = () => document.querySelector<HTMLElement>('free-shipping-bar')!;
const message = () => document.querySelector('[data-bar-message]')!.textContent;
const track = () => document.querySelector('[data-bar-track]')!;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('free-shipping bar in the DOM', () => {
  it("upgrading the server render doesn't re-announce its message", async () => {
    const template = document.createElement('template');
    template.innerHTML = await renderBar(3_800_000);
    // happy-dom watches only nodes already in the observed tree when they connect, so the markup
    // joins a watched, detached host first and the host's insertion then upgrades the bar.
    const host = document.createElement('div');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    host.append(template.content);
    document.body.append(host);
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();

    const messageEl = document.querySelector('[data-bar-message]')!;
    expect(records.filter((r) => messageEl.contains(r.target))).toEqual([]);
    expect(records.map((r) => r.attributeName)).not.toContain('aria-valuenow');
    expect(records.map((r) => r.attributeName)).not.toContain('aria-valuetext');
    expect(message()).toBe('You’re $82.000 away from free shipping');
    expect(track().getAttribute('aria-valuenow')).toBe('31');
  });

  it.each([
    ['a cart update re-reads /cart.js and shows the reached message', () => new CustomEvent(CART_EVENT, { detail: { promise: Promise.resolve() } })],
    ['a cart update event without detail still refreshes the total', () => new CustomEvent(CART_EVENT)],
  ])('%s', async (_name, event) => {
    mount(await renderBar(3_800_000));
    const fetchMock = stubFetch(() => cartResponse(15_200_000));
    document.dispatchEvent(event());
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/cart.js');
      expect(message()).toBe('You’ve got free shipping!');
      expect(bar().dataset.state).toBe('reached');
      expect(track().getAttribute('aria-valuenow')).toBe('100');
    });
  });

  it('a failed cart read keeps the last message and warns', async () => {
    mount(await renderBar(3_800_000));
    stubFetch(() => Promise.resolve({ ok: false, status: 500 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe('free-shipping-bar: failed to refresh cart total');
    expect(message()).toBe('You’re $82.000 away from free shipping');
    expect(bar().dataset.state).toBe('remaining');
    expect(bar().dataset.totalCents).toBe('3800000');
  });

  it('a bar missing its children warns once, however often it renders', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount('<free-shipping-bar data-threshold-cents="12000000" data-total-cents="0"></free-shipping-bar>');
    bar().dataset.totalCents = '100';
    bar().dataset.totalCents = '200';
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a removed bar no longer listens for cart updates', async () => {
    mount(await renderBar(3_800_000));
    const fetchMock = stubFetch(() => cartResponse(15_200_000));
    bar().remove();
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await ticks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a zero threshold hides the bar', async () => {
    mount(await renderBar(3_800_000));
    expect(bar().hidden).toBe(false);
    bar().dataset.thresholdCents = '0';
    bar().dataset.totalCents = '4000000';
    expect(bar().hidden).toBe(true);
  });
});
