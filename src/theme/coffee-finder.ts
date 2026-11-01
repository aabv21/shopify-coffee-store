// The coffee finder: a three-question form that recommends one or two coffees from product
// metafields and adds the chosen bag to the cart. Uses textContent only, never innerHTML.
import { parseProducts, readAnswers, recommend, type FinderProduct, type FinderVariant } from './recommend.ts';
import './shopify-actions.d.ts';

const TAG_NAME = 'coffee-finder';

function textOf(root: ParentNode, selector: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(selector);
}

class CoffeeFinder extends HTMLElement {
  #warnedMissingContract = false;

  connectedCallback(): void {
    const form = textOf(this, '[data-finder-form]');
    if (form instanceof HTMLFormElement) form.addEventListener('submit', (event) => { this.onSubmit(event, form); });

    this.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-card-add]');
      if (button) void this.onAdd(button);
    });
  }

  private readProducts(): FinderProduct[] {
    const script = textOf(this, 'script[data-finder-products]');
    if (!script?.textContent) return [];
    try {
      return parseProducts(JSON.parse(script.textContent));
    } catch {
      return [];
    }
  }

  private onSubmit(event: SubmitEvent, form: HTMLFormElement): void {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const answers = readAnswers(new FormData(form).entries());
    const picks = answers ? recommend(this.readProducts(), answers) : [];
    this.renderResults(picks);
  }

  private renderResults(picks: ReturnType<typeof recommend>): void {
    const results = textOf(this, '[data-finder-results]');
    const empty = textOf(this, '[data-finder-empty]');
    const list = textOf(this, '[data-finder-list]');
    const heading = textOf(this, '[data-finder-heading]');
    const template = this.querySelector<HTMLTemplateElement>('template[data-finder-card]');
    if (!results || !empty || !list || !heading || !template) return;

    list.textContent = '';
    empty.hidden = picks.length > 0;

    for (const pick of picks) {
      const card = this.renderCard(template, pick.product, pick.variant);
      if (card) list.append(card);
    }

    results.hidden = false;
    heading.focus();
  }

  private renderCard(template: HTMLTemplateElement, product: FinderProduct, variant: FinderVariant): DocumentFragment | null {
    const fragment = template.content.cloneNode(true) as DocumentFragment;

    const image = fragment.querySelector<HTMLImageElement>('[data-card-image]');
    if (image) {
      if (product.image) {
        image.src = product.image.src;
        image.alt = product.image.alt;
      } else {
        image.hidden = true;
      }
    }

    const title = fragment.querySelector<HTMLElement>('[data-card-title]');
    if (title) title.textContent = product.title;

    const variantLabel = fragment.querySelector<HTMLElement>('[data-card-variant]');
    if (variantLabel) variantLabel.textContent = variant.title;

    const notes = fragment.querySelector<HTMLElement>('[data-card-notes]');
    if (notes) notes.textContent = product.tastingNotes ?? '';

    const price = fragment.querySelector<HTMLElement>('[data-card-price]');
    if (price) price.textContent = variant.price;

    const link = fragment.querySelector<HTMLAnchorElement>('[data-card-link]');
    if (link) link.href = product.url;

    const addButton = fragment.querySelector<HTMLButtonElement>('[data-card-add]');
    if (addButton) {
      addButton.dataset.variantId = String(variant.id);
      const nameSlot = addButton.querySelector<HTMLElement>('[data-card-add-name]');
      if (nameSlot) nameSlot.textContent = `${product.title} ${variant.title}`;
    }

    return fragment;
  }

  private async onAdd(button: HTMLButtonElement): Promise<void> {
    const variantId = button.dataset.variantId;
    const status = button.closest('.coffee-finder__card')?.querySelector<HTMLElement>('[data-card-status]');
    const messages = textOf(this, '[data-finder-messages]');
    if (!variantId || !status || !messages) {
      if (!this.#warnedMissingContract) {
        console.warn('coffee-finder: missing variant id, [data-card-status], or [data-finder-messages]');
        this.#warnedMissingContract = true;
      }
      return;
    }

    const addedText = messages.dataset.added ?? '';
    const errorText = messages.dataset.error ?? '';

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const actions = window.Shopify?.actions;
      if (actions) {
        const result = await actions.updateCart(
          { lines: [{ merchandiseId: variantId, quantity: 1 }] },
          { event: { context: 'standard-action' } },
        );
        if (result.userErrors && result.userErrors.length > 0) {
          status.textContent = errorText;
        } else {
          // The item is already in the cart once userErrors comes back empty, so the status
          // reflects that right away; opening the drawer is a separate, best-effort step that
          // must never turn a real success into a reported failure.
          status.textContent = this.successText(addedText, result.warnings);
          try {
            await actions.openCart();
          } catch (err: unknown) {
            console.warn('coffee-finder: openCart failed after a successful add', err);
          }
        }
      } else {
        await this.addViaCartAjax(variantId, status, addedText, errorText);
      }
    } catch {
      status.textContent = errorText;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  private successText(addedText: string, warnings?: { message: string }[]): string {
    if (!warnings || warnings.length === 0) return addedText;
    return [addedText, ...warnings.map((warning) => warning.message)].join(' ');
  }

  private async addViaCartAjax(variantId: string, status: HTMLElement, addedText: string, errorText: string): Promise<void> {
    const cartAddUrl = this.dataset.cartAddUrl ?? '/cart/add';
    const cartUrl = this.dataset.cartUrl ?? '/cart';

    const response = await fetch(`${cartAddUrl}.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
    });

    if (response.ok) {
      status.textContent = addedText;
      window.location.assign(cartUrl);
    } else {
      status.textContent = errorText;
    }
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CoffeeFinder);
