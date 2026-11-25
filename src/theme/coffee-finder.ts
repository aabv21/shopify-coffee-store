// Writes text only through textContent, never innerHTML: product data and settings are
// merchant-entered, and Shopify's messages are text too.
import { favoritePicks, isPreferredSize, missingAnswers, parseProducts, readAnswers, recommend, type FinderProduct, type FinderVariant, type Question } from './recommend.ts';
import './shopify-actions.d.ts';

const TAG_NAME = 'coffee-finder';

type StatusState = 'success' | 'error';

function textOf(root: ParentNode, selector: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(selector);
}

class CoffeeFinder extends HTMLElement {
  #warnedMissingContract = false;

  connectedCallback(): void {
    const form = textOf(this, '[data-finder-form]');
    if (form instanceof HTMLFormElement) {
      form.addEventListener('submit', (event) => { this.onSubmit(event, form); });
      // Once an unanswered question is flagged, answering it clears that flag right away.
      form.addEventListener('change', () => {
        if (form.querySelector('[data-unanswered]')) this.flagMissing(form, missingAnswers(new FormData(form).entries()), { focus: false });
      });
    }

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
    const entries = [...new FormData(form).entries()];
    const missing = missingAnswers(entries);
    this.flagMissing(form, missing, { focus: true });
    if (missing.length > 0) return;

    const answers = readAnswers(entries);
    if (!answers) return;
    const products = this.readProducts();
    const matches = recommend(products, answers);
    this.renderResults(matches.length > 0 ? matches : favoritePicks(products, answers.people), { matched: matches.length > 0, people: answers.people });
  }

  /** The error text is a `role="alert"` region, so setting it announces the problem. */
  private flagMissing(form: HTMLFormElement, missing: readonly Question[], o: { focus: boolean }): void {
    const error = textOf(this, '[data-finder-error]');
    if (error) error.textContent = missing.length > 0 ? (error.dataset.message ?? '') : '';

    // Every radio in a fieldset shares its question's name, so each one sets the same flag.
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      const unanswered = (missing as readonly string[]).includes(input.name);
      const fieldset = input.closest('fieldset');
      fieldset?.toggleAttribute('data-unanswered', unanswered);
      const line = fieldset?.querySelector<HTMLElement>('[data-question-error]');
      if (line) line.hidden = !unanswered;
      if (unanswered) {
        input.setAttribute('aria-invalid', 'true');
        const ids = [line?.id, error?.id].filter((id): id is string => Boolean(id));
        if (ids.length > 0) input.setAttribute('aria-describedby', ids.join(' '));
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    }

    const [first] = missing;
    if (o.focus && first) form.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
  }

  private renderResults(picks: ReturnType<typeof recommend>, o: { matched: boolean; people: 1 | 2 | 3 }): void {
    const results = textOf(this, '[data-finder-results]');
    const empty = textOf(this, '[data-finder-empty]');
    const list = textOf(this, '[data-finder-list]');
    const heading = textOf(this, '[data-finder-heading]');
    const template = this.querySelector<HTMLTemplateElement>('template[data-finder-card]');
    if (!results || !empty || !list || !heading || !template) return;

    list.textContent = '';
    empty.hidden = o.matched;
    heading.textContent = (o.matched ? heading.dataset.matchHeading : heading.dataset.emptyHeading) ?? heading.textContent;

    const emptyText = textOf(this, '[data-finder-empty-text]');
    if (emptyText && !o.matched) {
      const wording = picks.length === 0 ? emptyText.dataset.textNone : picks.length === 1 ? emptyText.dataset.textOne : emptyText.dataset.textTwo;
      emptyText.textContent = wording ?? emptyText.textContent;
    }

    // One line for the whole answer, said only while every card shows the size it asks for: a
    // sold-out bag makes a card fall back to another size, and then the line would be false.
    const messages = textOf(this, '[data-finder-messages]');
    const sizeReason = textOf(this, '[data-finder-size-reason]');
    if (sizeReason) {
      const fits = picks.length > 0 && picks.every((pick) => isPreferredSize(pick.product, pick.variant, o.people));
      sizeReason.textContent = fits ? ((o.people === 3 ? messages?.dataset.sizeLarge : messages?.dataset.sizeSmall) ?? '') : '';
      sizeReason.hidden = !fits;
    }

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
        if (product.image.src2x) {
          image.srcset = `${product.image.src} 400w, ${product.image.src2x} 800w`;
          image.sizes = '(min-width: 750px) 19rem, 6.5rem';
        }
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

  private setStatus(status: HTMLElement, state: StatusState, text: string): void {
    status.dataset.state = state;
    status.textContent = text;
  }

  private async onAdd(button: HTMLButtonElement): Promise<void> {
    // aria-busy, not disabled: disabling the focused button would drop keyboard focus to <body>.
    if (button.getAttribute('aria-busy') === 'true') return;
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

    button.setAttribute('aria-busy', 'true');
    status.textContent = '';
    delete status.dataset.state;

    try {
      const actions = window.Shopify?.actions;
      if (actions) {
        const result = await actions.updateCart(
          { lines: [{ merchandiseId: variantId, quantity: 1 }] },
          { event: { context: 'standard-action' } },
        );
        if (result.userErrors && result.userErrors.length > 0) {
          this.setStatus(status, 'error', errorText);
        } else {
          // The add already succeeded; opening the drawer is best-effort and can't undo that.
          this.setStatus(status, 'success', this.successText(addedText, result.warnings));
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
      this.setStatus(status, 'error', errorText);
    } finally {
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
      this.setStatus(status, 'success', addedText);
      window.location.assign(cartUrl);
    } else {
      this.setStatus(status, 'error', errorText);
    }
  }
}

if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CoffeeFinder);
