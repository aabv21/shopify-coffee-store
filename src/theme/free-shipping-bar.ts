// The free-shipping progress bar. Renders from its own attributes and stays live two ways: when
// Shopify.actions.updateCart fires shopify:cart:lines-update, and otherwise through Horizon's own
// section morph, which copies this element's attributes (including data-total-cents) even while
// data-skip-subtree-update keeps the morph from touching its JS-rendered children.
import './shopify-actions.d.ts';
import { addToCart } from './cart-add.ts';
import { barMessage, freeShippingProgress, parseSuggestionCandidates, pickSuggestion, type SuggestionCandidate } from './free-shipping.ts';

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
  #candidates: SuggestionCandidate[] | undefined;
  #suggested: SuggestionCandidate | null = null;

  #onClick = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('[data-suggestion-add]')) void this.addSuggestion();
  };

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
    this.addEventListener('click', this.#onClick);
  }

  disconnectedCallback(): void {
    document.removeEventListener(CART_EVENT, this.#onLinesUpdate);
    this.removeEventListener('click', this.#onClick);
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
    setAttributeIfChanged(this, 'data-state', state.reached ? 'reached' : 'remaining');
    fillEl.style.setProperty('--free-shipping-progress', (state.percent / 100).toString());
    this.renderSuggestion(state.remainingCents);
  }

  /** The candidates the Liquid rendered, read once; none when the suggestion is turned off. */
  private candidates(): SuggestionCandidate[] {
    if (this.#candidates === undefined) {
      const script = this.querySelector('script[data-bar-suggestions]');
      try {
        this.#candidates = parseSuggestionCandidates(JSON.parse(script?.textContent ?? '[]') as unknown);
      } catch {
        this.#candidates = [];
      }
    }
    return this.#candidates;
  }

  private renderSuggestion(remainingCents: number): void {
    const box = this.querySelector<HTMLElement>('[data-bar-suggestion]');
    const textEl = this.querySelector<HTMLElement>('[data-suggestion-text]');
    if (!box || !textEl) return;
    const pick = pickSuggestion(this.candidates(), remainingCents);
    this.#suggested = pick;
    // A hidden row can't hold focus, so a keyboard or screen-reader user who just pressed "Add" lands on the message.
    if (pick === null && box.contains(document.activeElement)) this.querySelector<HTMLElement>('[data-bar-message]')?.focus();
    box.hidden = pick === null;
    if (pick === null) return;
    const text = (box.dataset.message ?? '').replace('[product]', pick.label).replace('[price]', pick.price);
    if (textEl.textContent !== text) textEl.textContent = text;
  }

  private async addSuggestion(): Promise<void> {
    const pick = this.#suggested;
    const button = this.querySelector<HTMLButtonElement>('[data-suggestion-add]');
    const status = this.querySelector<HTMLElement>('[data-suggestion-status]');
    const box = this.querySelector<HTMLElement>('[data-bar-suggestion]');
    if (!pick || !button || !status || !box || button.hasAttribute('aria-busy')) return;

    button.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      let added = false;
      try {
        added = (await addToCart(String(pick.variantId), {
          cartAddUrl: this.dataset.cartAddUrl ?? '/cart/add',
          cartUrl: this.dataset.cartUrl ?? '/cart',
          openCart: false,
        })).ok;
      } catch (err: unknown) {
        console.warn('free-shipping-bar: could not add the suggested bag', err);
      }
      if (!added) {
        status.textContent = box.dataset.error ?? '';
        return;
      }
      // The bag is in the cart by now. Horizon's own event refreshes the bar too, so a failed read only warns.
      try {
        this.dataset.totalCents = (await readCart(this.dataset.cartUrl ?? '/cart')).total_price.toString();
      } catch (err: unknown) {
        console.warn('free-shipping-bar: failed to refresh cart total', err);
      }
    } finally {
      button.removeAttribute('aria-busy');
    }
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, FreeShippingBar);
