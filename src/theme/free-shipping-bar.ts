// The free-shipping progress bar. Renders from its own attributes and stays live two ways: when
// Shopify.actions.updateCart fires shopify:cart:lines-update, and otherwise through Horizon's own
// section morph, which copies this element's attributes (including data-total-cents) even while
// data-skip-subtree-update keeps the morph from touching its JS-rendered children.
import { barMessage, freeShippingProgress } from './free-shipping.ts';

const TAG_NAME = 'free-shipping-bar';
const CART_EVENT = 'shopify:cart:lines-update';

interface CartEventDetail { promise?: Promise<unknown> }

function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function readCart(cartUrl: string): Promise<{ total_price: number }> {
  return fetch(`${cartUrl}.js`).then((response) => {
    if (!response.ok) throw new Error(`cart fetch failed: ${response.status.toString()}`);
    return response.json() as Promise<{ total_price: number }>;
  });
}

class FreeShippingBar extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['data-total-cents'];
  }

  #warnedMissingContract = false;

  #onLinesUpdate = (event: Event): void => {
    const detail = (event as CustomEvent<CartEventDetail | undefined>).detail;
    const promise = detail?.promise ?? Promise.resolve();
    void promise
      .then(() => readCart(this.dataset.cartUrl ?? '/cart'))
      .then((cart) => {
        this.dataset.totalCents = cart.total_price.toString();
      })
      .catch((err: unknown) => {
        console.warn('free-shipping-bar: failed to refresh cart total', err);
      });
  };

  connectedCallback(): void {
    this.render();
    document.addEventListener(CART_EVENT, this.#onLinesUpdate);
  }

  disconnectedCallback(): void {
    document.removeEventListener(CART_EVENT, this.#onLinesUpdate);
  }

  attributeChangedCallback(name: string): void {
    if (name === 'data-total-cents') this.render();
  }

  private render(): void {
    const totalCents = Number(this.dataset.totalCents ?? '0');
    const thresholdCents = Number(this.dataset.thresholdCents ?? '0');
    const state = freeShippingProgress(totalCents, thresholdCents);

    if (state === null) {
      this.hidden = true;
      return;
    }
    this.hidden = false;

    const messageEl = this.querySelector<HTMLElement>('[data-bar-message]');
    const trackEl = this.querySelector<HTMLElement>('[data-bar-track]');
    const fillEl = this.querySelector<HTMLElement>('[data-bar-fill]');
    if (!messageEl || !trackEl || !fillEl) {
      if (!this.#warnedMissingContract) {
        console.warn('free-shipping-bar: missing [data-bar-message], [data-bar-track], or [data-bar-fill]');
        this.#warnedMissingContract = true;
      }
      return;
    }

    const messages = { remaining: this.dataset.messageRemaining ?? '', reached: this.dataset.messageReached ?? '' };
    const moneyFormat = this.dataset.moneyFormat ?? '{{amount}}';

    const message = barMessage(state, messages, moneyFormat);
    // Only real changes are written, so the polite live region doesn't re-announce the message
    // the server already rendered.
    if (messageEl.textContent !== message) messageEl.textContent = message;
    setAttributeIfChanged(trackEl, 'aria-valuenow', state.percent.toString());
    setAttributeIfChanged(trackEl, 'aria-valuetext', message);
    setAttributeIfChanged(this, 'data-state', state.reached ? 'reached' : 'remaining');
    fillEl.style.setProperty('--free-shipping-progress', (state.percent / 100).toString());
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, FreeShippingBar);
