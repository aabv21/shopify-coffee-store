import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Insertion =
  | { kind: 'before-line'; file: string; anchor: string; content: string }
  | { kind: 'append-settings-group'; file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }
  | { kind: 'add-section-after'; file: string; after: string; key: string; section: { type: string; settings: Record<string, unknown> } };

export class InsertionError extends Error {}

export const INSERTIONS: readonly Insertion[] = [
  {
    kind: 'before-line',
    file: 'snippets/cart-summary.liquid',
    anchor: '<div class="cart-totals">',
    content: "{% render 'free-shipping-bar' %}",
  },
  {
    kind: 'append-settings-group',
    file: 'config/settings_schema.json',
    group: {
      name: 'Free shipping bar',
      settings: [
        { type: 'checkbox', id: 'free_shipping_bar_enabled', label: 'Show the free shipping bar', default: true },
        {
          type: 'number',
          id: 'free_shipping_threshold',
          label: 'Free shipping threshold',
          default: 120000,
          info: 'Whole amount in the store currency. Match the free shipping rate in Settings > Shipping and delivery.',
        },
        {
          type: 'text',
          id: 'free_shipping_message_remaining',
          label: 'Message: amount remaining',
          default: "You're [amount] away from free shipping",
          info: '[amount] shows the amount left.',
        },
        {
          type: 'text',
          id: 'free_shipping_message_reached',
          label: 'Message: free shipping reached',
          default: "You've got free shipping!",
        },
        {
          type: 'text',
          id: 'free_shipping_progress_label',
          label: 'Progress bar accessible label',
          default: 'Progress toward free shipping',
        },
      ],
    },
  },
  {
    kind: 'add-section-after',
    file: 'templates/index.json',
    after: 'hero_jVaWmY',
    key: 'coffee_finder',
    section: { type: 'coffee-finder', settings: {} },
  },
];

function readThemeFile(themeDir: string, file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  return readFileSync(join(themeDir, file), 'utf8');
}

function writeThemeFile(themeDir: string, file: string, content: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  writeFileSync(join(themeDir, file), content);
}

function applyBeforeLine(themeDir: string, insertion: { file: string; anchor: string; content: string }): void {
  const text = readThemeFile(themeDir, insertion.file);
  const count = text.split(insertion.anchor).length - 1;
  if (count === 0) throw new InsertionError(`${insertion.file}: anchor not found: ${insertion.anchor}`);
  if (count > 1) throw new InsertionError(`${insertion.file}: anchor appears ${count.toString()} times: ${insertion.anchor}`);
  writeThemeFile(themeDir, insertion.file, text.replace(insertion.anchor, `${insertion.content}\n${insertion.anchor}`));
}

function applyAppendSettingsGroup(themeDir: string, insertion: { file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }): void {
  const groups = JSON.parse(readThemeFile(themeDir, insertion.file)) as { name: string }[];
  if (groups.some((g) => g.name === insertion.group.name)) {
    throw new InsertionError(`${insertion.file}: settings group exists: ${insertion.group.name}`);
  }
  groups.push(insertion.group);
  writeThemeFile(themeDir, insertion.file, `${JSON.stringify(groups, null, 2)}\n`);
}

// A JSON template may start with a Shopify-generated `/* ... */` comment; this keeps it as the
// literal prefix instead of round-tripping through JSON.stringify, which would drop it.
function splitLeadingComment(text: string): { comment: string; json: string } {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/*')) return { comment: '', json: text };
  const end = trimmed.indexOf('*/');
  if (end === -1) return { comment: '', json: text };
  const commentEnd = end + '*/'.length;
  return { comment: trimmed.slice(0, commentEnd), json: trimmed.slice(commentEnd) };
}

function applyAddSectionAfter(themeDir: string, insertion: { file: string; after: string; key: string; section: { type: string; settings: Record<string, unknown> } }): void {
  const raw = readThemeFile(themeDir, insertion.file);
  const { comment, json } = splitLeadingComment(raw);
  const parsed = JSON.parse(json) as { sections: Record<string, unknown>; order: string[] };

  if (!(insertion.after in parsed.sections)) throw new InsertionError(`${insertion.file}: section not found: ${insertion.after}`);
  if (insertion.key in parsed.sections) throw new InsertionError(`${insertion.file}: section exists: ${insertion.key}`);

  parsed.sections[insertion.key] = insertion.section;
  const index = parsed.order.indexOf(insertion.after);
  parsed.order.splice(index + 1, 0, insertion.key);

  const body = `${JSON.stringify(parsed, null, 2)}\n`;
  writeThemeFile(themeDir, insertion.file, comment ? `${comment}\n${body}` : body);
}

export function applyInsertion(themeDir: string, insertion: Insertion): void {
  switch (insertion.kind) {
    case 'before-line':
      applyBeforeLine(themeDir, insertion);
      return;
    case 'append-settings-group':
      applyAppendSettingsGroup(themeDir, insertion);
      return;
    case 'add-section-after':
      applyAddSectionAfter(themeDir, insertion);
      return;
  }
}
