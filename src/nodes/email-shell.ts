// No Node imports: Code nodes bundle this.
import type { Locale } from '../lib/locale.ts';

/** The theme's brand colors (`BRAND_PALETTE`), inlined because email clients ignore stylesheets. */
export const EMAIL_COLORS = { background: '#FBF7F2', text: '#2B1B12', accent: '#7C2D12', muted: '#6B5B4E' } as const;

const STORE_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The storefront's home page in the customer's language, or null when `store` isn't a store subdomain. */
export function storeUrl(store: string, locale: Locale): string | null {
  if (!STORE_RE.test(store)) return null;
  return `https://${store}.myshopify.com/${locale === 'en' ? '' : locale}`;
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  // eslint-disable-next-line security/detect-object-injection -- char is always one of ESCAPE_RE's own fixed characters
  return value.replace(ESCAPE_RE, (char) => ESCAPES[char] ?? char);
}

export interface BrandedEmail {
  lang: Locale;
  title: string;
  /** Already escaped by the caller. */
  bodyHtml: string;
  cta: { label: string; url: string } | null;
  footer: string;
  /** Inbox preview text, hidden in the message itself. Escaped here. */
  preheader?: string;
}

const FONT = "font-family:Georgia,'Times New Roman',serif";

export function brandedEmail(o: BrandedEmail): string {
  const c = EMAIL_COLORS;
  const button =
    o.cta === null
      ? ''
      : `<tr><td style="padding:8px 24px 24px"><a href="${escapeHtml(o.cta.url)}" style="background:${c.accent};color:${c.background};padding:12px 20px;border-radius:4px;text-decoration:none;display:inline-block;${FONT};font-size:16px">${escapeHtml(o.cta.label)}</a></td></tr>`;
  const preheader =
    o.preheader === undefined
      ? ''
      : `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;opacity:0">${escapeHtml(o.preheader)}</div>`;
  return [
    `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(o.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${c.background}">${preheader}`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.background}"><tr><td align="center" style="padding:24px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;color:${c.text};${FONT};font-size:16px;line-height:1.5;text-align:left">`,
    `<tr><td style="padding:0 24px 16px;color:${c.accent};font-size:24px;font-weight:bold">Nubandina Coffee</td></tr>`,
    `<tr><td style="padding:0 24px">${o.bodyHtml}</td></tr>`,
    button,
    `<tr><td style="padding:16px 24px 0;color:${c.muted};font-size:13px">${escapeHtml(o.footer)}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join('');
}
