// Generated from src/theme/coffee-finder.ts by pnpm run build:theme; edit the source.

// src/theme/recommend.ts
var TASTE_TO_ROAST = {
  mild: "light",
  balanced: "medium",
  intense: "dark"
};
var BREW_METHODS = ["pour-over", "espresso", "french-press"];
var TASTES = ["mild", "balanced", "intense"];
var PEOPLE = /* @__PURE__ */ new Set([1, 2, 3]);
function isBrewMethod(value) {
  return typeof value === "string" && BREW_METHODS.includes(value);
}
function isTaste(value) {
  return typeof value === "string" && TASTES.includes(value);
}
function pickVariant(variants, people) {
  const available = variants.filter((v) => v.available);
  if (available.length === 0) return null;
  let best = available[0];
  for (const variant of available.slice(1)) {
    if (!best) {
      best = variant;
      continue;
    }
    const lighter = variant.grams < best.grams;
    const heavier = variant.grams > best.grams;
    if (people === 3 && heavier || people !== 3 && lighter) best = variant;
  }
  return best ?? null;
}
function score(product, answers) {
  let total = 0;
  if (product.brewMethod === answers.brewMethod) total += 2;
  if (product.roast === TASTE_TO_ROAST[answers.taste]) total += 1;
  return total;
}
function recommend(products, answers) {
  const available = products.filter((product) => product.variants.some((v) => v.available));
  const scored = available.map((product) => ({ product, points: score(product, answers) })).filter((entry) => entry.points > 0);
  scored.sort((a, b) => b.points - a.points);
  const bestScore = scored[0]?.points ?? 0;
  const chosen = bestScore === 3 ? scored.filter((entry) => entry.points === 3) : scored;
  const picks = [];
  for (const entry of chosen.slice(0, 2)) {
    const variant = pickVariant(entry.product.variants, answers.people);
    if (variant) picks.push({ product: entry.product, variant });
  }
  return picks;
}
function readAnswers(entries) {
  let brewMethod = null;
  let taste = null;
  let people = null;
  for (const [key, value] of entries) {
    if (key === "brew_method" && isBrewMethod(value)) brewMethod = value;
    else if (key === "taste" && isTaste(value)) taste = value;
    else if (key === "people" && typeof value === "string" && PEOPLE.has(Number(value))) people = Number(value);
  }
  if (brewMethod === null || taste === null || people === null) return null;
  return { brewMethod, taste, people };
}
function parseVariant(value) {
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  if (typeof v.id !== "number") return null;
  return {
    id: v.id,
    title: typeof v.title === "string" ? v.title : "",
    grams: typeof v.grams === "number" ? v.grams : 0,
    available: v.available === true,
    price: typeof v.price === "string" ? v.price : ""
  };
}
function parseProduct(value) {
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  if (typeof v.id !== "number" || typeof v.title !== "string") return null;
  if (!Array.isArray(v.variants)) return null;
  const variants = v.variants.map(parseVariant).filter((variant) => variant !== null);
  if (variants.length === 0) return null;
  const image = typeof v.image === "object" && v.image !== null && "src" in v.image && "alt" in v.image ? { src: String(v.image.src), alt: String(v.image.alt) } : null;
  return {
    id: v.id,
    title: v.title,
    url: typeof v.url === "string" ? v.url : "",
    image,
    roast: typeof v.roast === "string" ? v.roast : null,
    brewMethod: typeof v.brewMethod === "string" ? v.brewMethod : null,
    tastingNotes: typeof v.tastingNotes === "string" ? v.tastingNotes : null,
    variants
  };
}
function parseProducts(data) {
  if (!Array.isArray(data)) return [];
  const products = [];
  for (const entry of data) {
    const product = parseProduct(entry);
    if (product) products.push(product);
  }
  return products;
}

// src/theme/coffee-finder.ts
var TAG_NAME = "coffee-finder";
function textOf(root, selector) {
  return root.querySelector(selector);
}
var CoffeeFinder = class extends HTMLElement {
  #warnedMissingContract = false;
  connectedCallback() {
    const form = textOf(this, "[data-finder-form]");
    if (form instanceof HTMLFormElement) form.addEventListener("submit", (event) => {
      this.onSubmit(event, form);
    });
    this.addEventListener("click", (event) => {
      const button = event.target.closest("[data-card-add]");
      if (button) void this.onAdd(button);
    });
  }
  readProducts() {
    const script = textOf(this, "script[data-finder-products]");
    if (!script?.textContent) return [];
    try {
      return parseProducts(JSON.parse(script.textContent));
    } catch {
      return [];
    }
  }
  onSubmit(event, form) {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const answers = readAnswers(new FormData(form).entries());
    const picks = answers ? recommend(this.readProducts(), answers) : [];
    this.renderResults(picks);
  }
  renderResults(picks) {
    const results = textOf(this, "[data-finder-results]");
    const empty = textOf(this, "[data-finder-empty]");
    const list = textOf(this, "[data-finder-list]");
    const heading = textOf(this, "[data-finder-heading]");
    const template = this.querySelector("template[data-finder-card]");
    if (!results || !empty || !list || !heading || !template) return;
    list.textContent = "";
    empty.hidden = picks.length > 0;
    for (const pick of picks) {
      const card = this.renderCard(template, pick.product, pick.variant);
      if (card) list.append(card);
    }
    results.hidden = false;
    heading.focus();
  }
  renderCard(template, product, variant) {
    const fragment = template.content.cloneNode(true);
    const image = fragment.querySelector("[data-card-image]");
    if (image) {
      if (product.image) {
        image.src = product.image.src;
        image.alt = product.image.alt;
      } else {
        image.hidden = true;
      }
    }
    const title = fragment.querySelector("[data-card-title]");
    if (title) title.textContent = product.title;
    const variantLabel = fragment.querySelector("[data-card-variant]");
    if (variantLabel) variantLabel.textContent = variant.title;
    const notes = fragment.querySelector("[data-card-notes]");
    if (notes) notes.textContent = product.tastingNotes ?? "";
    const price = fragment.querySelector("[data-card-price]");
    if (price) price.textContent = variant.price;
    const link = fragment.querySelector("[data-card-link]");
    if (link) link.href = product.url;
    const addButton = fragment.querySelector("[data-card-add]");
    if (addButton) {
      addButton.dataset.variantId = String(variant.id);
      const nameSlot = addButton.querySelector("[data-card-add-name]");
      if (nameSlot) nameSlot.textContent = `${product.title} ${variant.title}`;
    }
    return fragment;
  }
  async onAdd(button) {
    const variantId = button.dataset.variantId;
    const status = button.closest(".coffee-finder__card")?.querySelector("[data-card-status]");
    const messages = textOf(this, "[data-finder-messages]");
    if (!variantId || !status || !messages) {
      if (!this.#warnedMissingContract) {
        console.warn("coffee-finder: missing variant id, [data-card-status], or [data-finder-messages]");
        this.#warnedMissingContract = true;
      }
      return;
    }
    const addedText = messages.dataset.added ?? "";
    const errorText = messages.dataset.error ?? "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const actions = window.Shopify?.actions;
      if (actions) {
        const result = await actions.updateCart(
          { lines: [{ merchandiseId: variantId, quantity: 1 }] },
          { event: { context: "standard-action" } }
        );
        if (result.userErrors && result.userErrors.length > 0) {
          status.textContent = errorText;
        } else {
          status.textContent = this.successText(addedText, result.warnings);
          try {
            await actions.openCart();
          } catch (err) {
            console.warn("coffee-finder: openCart failed after a successful add", err);
          }
        }
      } else {
        await this.addViaCartAjax(variantId, status, addedText, errorText);
      }
    } catch {
      status.textContent = errorText;
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
  successText(addedText, warnings) {
    if (!warnings || warnings.length === 0) return addedText;
    return [addedText, ...warnings.map((warning) => warning.message)].join(" ");
  }
  async addViaCartAjax(variantId, status, addedText, errorText) {
    const cartAddUrl = this.dataset.cartAddUrl ?? "/cart/add";
    const cartUrl = this.dataset.cartUrl ?? "/cart";
    const response = await fetch(`${cartAddUrl}.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] })
    });
    if (response.ok) {
      status.textContent = addedText;
      window.location.assign(cartUrl);
    } else {
      status.textContent = errorText;
    }
  }
};
if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CoffeeFinder);
