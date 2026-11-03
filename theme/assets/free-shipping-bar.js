// Generated from src/theme/free-shipping-bar.ts by pnpm run build:theme; edit the source.

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
  }
  disconnectedCallback() {
    document.removeEventListener(CART_EVENT, this.#onLinesUpdate);
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
    setAttributeIfChanged(trackEl, "aria-valuetext", message);
    setAttributeIfChanged(this, "data-state", state.reached ? "reached" : "remaining");
    fillEl.style.setProperty("--free-shipping-progress", (state.percent / 100).toString());
  }
};
if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, FreeShippingBar);
