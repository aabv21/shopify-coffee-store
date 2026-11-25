// Generated from src/theme/free-shipping-bar.ts by pnpm run build:theme; edit the source.

// src/theme/cart-add.ts
async function addToCart(variantId, o) {
  const actions = window.Shopify?.actions;
  if (actions) {
    const result = await actions.updateCart(
      { lines: [{ merchandiseId: variantId, quantity: 1 }] },
      { event: { context: "standard-action" } }
    );
    if (result.userErrors && result.userErrors.length > 0) return { ok: false, warnings: [] };
    if (o.openCart) {
      try {
        await actions.openCart();
      } catch (err) {
        console.warn("cart-add: openCart failed after a successful add", err);
      }
    }
    return { ok: true, warnings: (result.warnings ?? []).map((warning) => warning.message) };
  }
  const response = await fetch(`${o.cartAddUrl}.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] })
  });
  if (!response.ok) return { ok: false, warnings: [] };
  if (o.openCart) window.location.assign(o.cartUrl);
  return { ok: true, warnings: [] };
}

// src/theme/money.ts
var DEFAULT_SEPARATORS = { thousands: ",", decimal: "." };
var SEPARATORS = /* @__PURE__ */ new Map([
  ["amount", DEFAULT_SEPARATORS],
  ["amount_no_decimals", { thousands: ",", decimal: "." }],
  ["amount_with_comma_separator", { thousands: ".", decimal: "," }],
  ["amount_no_decimals_with_comma_separator", { thousands: ".", decimal: "," }],
  ["amount_with_space_separator", { thousands: " ", decimal: "," }],
  ["amount_no_decimals_with_space_separator", { thousands: " ", decimal: "," }],
  ["amount_with_period_and_space_separator", { thousands: " ", decimal: "." }],
  ["amount_with_apostrophe_separator", { thousands: "'", decimal: "." }]
]);
var NO_DECIMALS = /* @__PURE__ */ new Set(["amount_no_decimals", "amount_no_decimals_with_comma_separator", "amount_no_decimals_with_space_separator"]);
function roundHalfUp(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function groupThousands(digits, separator) {
  let result = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += separator;
    result += digits.charAt(i);
  }
  return result;
}
function formatPlaceholder(cents, placeholder) {
  const decimals = NO_DECIMALS.has(placeholder) ? 0 : 2;
  const { thousands, decimal } = SEPARATORS.get(placeholder) ?? DEFAULT_SEPARATORS;
  const units = roundHalfUp(cents / 100, decimals);
  const [wholePart, decimalPart] = units.toFixed(decimals).split(".");
  const whole = groupThousands(wholePart ?? "0", thousands);
  return decimalPart === void 0 ? whole : `${whole}${decimal}${decimalPart}`;
}
function formatMoney(cents, format) {
  return format.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, placeholder) => formatPlaceholder(cents, placeholder));
}

// src/theme/free-shipping.ts
function freeShippingProgress(totalCents, thresholdCents) {
  if (!Number.isFinite(thresholdCents) || thresholdCents <= 0) return null;
  const total = Math.max(0, totalCents);
  const reached = total >= thresholdCents;
  const remainingCents = reached ? 0 : thresholdCents - total;
  const percent = Math.min(100, Math.floor(total * 100 / thresholdCents));
  return { reached, remainingCents, percent };
}
function barMessage(state, messages, moneyFormat) {
  if (state.reached) return messages.reached;
  return messages.remaining.replace("[amount]", formatMoney(state.remainingCents, moneyFormat));
}
function isCandidate(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = new Map(Object.entries(value));
  const id = v.get("variantId");
  const cents = v.get("priceCents");
  const label = v.get("label");
  return typeof id === "number" && Number.isFinite(id) && typeof cents === "number" && Number.isFinite(cents) && cents >= 0 && typeof label === "string" && label !== "" && typeof v.get("price") === "string" && typeof v.get("available") === "boolean";
}
function parseSuggestionCandidates(data) {
  return Array.isArray(data) ? data.filter(isCandidate) : [];
}
function pickSuggestion(candidates, remainingCents) {
  if (remainingCents <= 0) return null;
  let best = null;
  for (const candidate of candidates) {
    if (!candidate.available || candidate.priceCents < remainingCents) continue;
    if (best === null || candidate.priceCents < best.priceCents) best = candidate;
  }
  return best;
}

// src/theme/free-shipping-bar.ts
var TAG_NAME = "free-shipping-bar";
var CART_EVENT = "shopify:cart:lines-update";
function setAttributeIfChanged(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function readCart(cartUrl) {
  return fetch(`${cartUrl}.js`).then((response) => {
    if (!response.ok) throw new Error(`cart fetch failed: ${response.status.toString()}`);
    return response.json();
  });
}
var FreeShippingBar = class extends HTMLElement {
  static get observedAttributes() {
    return ["data-total-cents"];
  }
  #warnedMissingContract = false;
  #candidates;
  #suggested = null;
  #onClick = (event) => {
    if (event.target instanceof Element && event.target.closest("[data-suggestion-add]")) void this.addSuggestion();
  };
  #onLinesUpdate = (event) => {
    const detail = event.detail;
    const promise = detail?.promise ?? Promise.resolve();
    void promise.then(() => readCart(this.dataset.cartUrl ?? "/cart")).then((cart) => {
      this.dataset.totalCents = cart.total_price.toString();
    }).catch((err) => {
      console.warn("free-shipping-bar: failed to refresh cart total", err);
    });
  };
  connectedCallback() {
    this.render();
    document.addEventListener(CART_EVENT, this.#onLinesUpdate);
    this.addEventListener("click", this.#onClick);
  }
  disconnectedCallback() {
    document.removeEventListener(CART_EVENT, this.#onLinesUpdate);
    this.removeEventListener("click", this.#onClick);
  }
  attributeChangedCallback(name) {
    if (name === "data-total-cents") this.render();
  }
  render() {
    const totalCents = Number(this.dataset.totalCents ?? "0");
    const thresholdCents = Number(this.dataset.thresholdCents ?? "0");
    const state = freeShippingProgress(totalCents, thresholdCents);
    if (state === null) {
      this.hidden = true;
      return;
    }
    this.hidden = false;
    const messageEl = this.querySelector("[data-bar-message]");
    const trackEl = this.querySelector("[data-bar-track]");
    const fillEl = this.querySelector("[data-bar-fill]");
    if (!messageEl || !trackEl || !fillEl) {
      if (!this.#warnedMissingContract) {
        console.warn("free-shipping-bar: missing [data-bar-message], [data-bar-track], or [data-bar-fill]");
        this.#warnedMissingContract = true;
      }
      return;
    }
    const messages = { remaining: this.dataset.messageRemaining ?? "", reached: this.dataset.messageReached ?? "" };
    const moneyFormat = this.dataset.moneyFormat ?? "{{amount}}";
    const message = barMessage(state, messages, moneyFormat);
    if (messageEl.textContent !== message) messageEl.textContent = message;
    setAttributeIfChanged(trackEl, "aria-valuenow", state.percent.toString());
    setAttributeIfChanged(this, "data-state", state.reached ? "reached" : "remaining");
    fillEl.style.setProperty("--free-shipping-progress", (state.percent / 100).toString());
    this.renderSuggestion(state.remainingCents);
  }
  /** The candidates the Liquid rendered, read once; none when the suggestion is turned off. */
  candidates() {
    if (this.#candidates === void 0) {
      const script = this.querySelector("script[data-bar-suggestions]");
      try {
        this.#candidates = parseSuggestionCandidates(JSON.parse(script?.textContent ?? "[]"));
      } catch {
        this.#candidates = [];
      }
    }
    return this.#candidates;
  }
  renderSuggestion(remainingCents) {
    const box = this.querySelector("[data-bar-suggestion]");
    const textEl = this.querySelector("[data-suggestion-text]");
    if (!box || !textEl) return;
    const pick = pickSuggestion(this.candidates(), remainingCents);
    this.#suggested = pick;
    if (pick === null && box.contains(document.activeElement)) this.querySelector("[data-bar-message]")?.focus();
    box.hidden = pick === null;
    if (pick === null) return;
    const text = (box.dataset.message ?? "").replace("[product]", pick.label).replace("[price]", pick.price);
    if (textEl.textContent !== text) textEl.textContent = text;
  }
  async addSuggestion() {
    const pick = this.#suggested;
    const button = this.querySelector("[data-suggestion-add]");
    const status = this.querySelector("[data-suggestion-status]");
    const box = this.querySelector("[data-bar-suggestion]");
    if (!pick || !button || !status || !box || button.hasAttribute("aria-busy")) return;
    button.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      let added = false;
      try {
        added = (await addToCart(String(pick.variantId), {
          cartAddUrl: this.dataset.cartAddUrl ?? "/cart/add",
          cartUrl: this.dataset.cartUrl ?? "/cart",
          openCart: false
        })).ok;
      } catch (err) {
        console.warn("free-shipping-bar: could not add the suggested bag", err);
      }
      if (!added) {
        status.textContent = box.dataset.error ?? "";
        return;
      }
      try {
        this.dataset.totalCents = (await readCart(this.dataset.cartUrl ?? "/cart")).total_price.toString();
      } catch (err) {
        console.warn("free-shipping-bar: failed to refresh cart total", err);
      }
    } finally {
      button.removeAttribute("aria-busy");
    }
  }
};
if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, FreeShippingBar);
