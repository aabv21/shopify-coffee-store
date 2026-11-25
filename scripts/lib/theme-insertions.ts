import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseJsonc, stripJsonComments } from './jsonc.ts';

/**
 * With `from`, the setting must hold exactly that value (the anchor); without it, it must be
 * unset, so the schema default is replaced. Either way, `settings_schema.json` must declare `id`.
 */
export interface SettingChange { id: string; from?: unknown; to: unknown }

export type Insertion =
  | { kind: 'before-line'; file: string; anchor: string; content: string }
  | { kind: 'replace-anchor'; file: string; anchor: string; content: string }
  | { kind: 'append-settings-group'; file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }
  | { kind: 'add-section-after'; file: string; after: string; key: string; section: { type: string; settings: Record<string, unknown> } }
  | { kind: 'set-theme-settings'; file: 'config/settings_data.json'; changes: readonly SettingChange[] }
  | { kind: 'add-locale-namespace'; file: string; namespace: string; translations: Readonly<Record<string, unknown>> };

export class InsertionError extends Error {}

function readThemeFile(themeDir: string, file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  return readFileSync(join(themeDir, file), 'utf8');
}

function writeThemeFile(themeDir: string, file: string, content: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  writeFileSync(join(themeDir, file), content);
}

function readAnchored(themeDir: string, insertion: { file: string; anchor: string }): string {
  const text = readThemeFile(themeDir, insertion.file);
  const count = text.split(insertion.anchor).length - 1;
  if (count === 0) throw new InsertionError(`${insertion.file}: anchor not found: ${insertion.anchor}`);
  if (count > 1) throw new InsertionError(`${insertion.file}: anchor appears ${count.toString()} times: ${insertion.anchor}`);
  return text;
}

function applyBeforeLine(themeDir: string, insertion: { file: string; anchor: string; content: string }): void {
  const text = readAnchored(themeDir, insertion);
  writeThemeFile(themeDir, insertion.file, text.replace(insertion.anchor, `${insertion.content}\n${insertion.anchor}`));
}

function applyReplaceAnchor(themeDir: string, insertion: { file: string; anchor: string; content: string }): void {
  const text = readAnchored(themeDir, insertion);
  writeThemeFile(themeDir, insertion.file, text.replace(insertion.anchor, () => insertion.content));
}

function applyAppendSettingsGroup(themeDir: string, insertion: { file: 'config/settings_schema.json'; group: { name: string; settings: readonly Record<string, unknown>[] } }): void {
  const groups = JSON.parse(readThemeFile(themeDir, insertion.file)) as { name: string }[];
  if (groups.some((g) => g.name === insertion.group.name)) {
    throw new InsertionError(`${insertion.file}: settings group exists: ${insertion.group.name}`);
  }
  groups.push(insertion.group);
  writeThemeFile(themeDir, insertion.file, `${JSON.stringify(groups, null, 2)}\n`);
}

// Keeps a JSON template's Shopify-generated `/* ... */` comment, which JSON.stringify would drop.
export function splitLeadingComment(text: string): { comment: string; json: string } {
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

function schemaSettingIds(themeDir: string): Set<string> {
  const groups = JSON.parse(readThemeFile(themeDir, 'config/settings_schema.json')) as { settings?: { id?: unknown }[] }[];
  const ids = new Set<string>();
  for (const group of groups) {
    for (const setting of group.settings ?? []) if (typeof setting.id === 'string') ids.add(setting.id);
  }
  return ids;
}

function applySetThemeSettings(themeDir: string, insertion: { file: 'config/settings_data.json'; changes: readonly SettingChange[] }): void {
  const ids = schemaSettingIds(themeDir);
  const { comment, json } = splitLeadingComment(readThemeFile(themeDir, insertion.file));
  const data = JSON.parse(json) as { current?: unknown };
  const current = data.current;
  if (typeof current !== 'object' || current === null || Array.isArray(current)) {
    throw new InsertionError(`${insertion.file}: "current" is not an object of settings`);
  }
  const settings = current as Record<string, unknown>;

  for (const change of insertion.changes) {
    if (!ids.has(change.id)) throw new InsertionError(`${insertion.file}: settings_schema.json declares no setting ${change.id}`);
    if ('from' in change) {
      if (!isDeepStrictEqual(settings[change.id], change.from)) {
        throw new InsertionError(`${insertion.file}: ${change.id} is ${JSON.stringify(settings[change.id])}, expected ${JSON.stringify(change.from)}`);
      }
    } else if (change.id in settings) {
      throw new InsertionError(`${insertion.file}: ${change.id} is already set to ${JSON.stringify(settings[change.id])}`);
    }
    settings[change.id] = change.to;
  }

  const body = `${JSON.stringify(data, null, 2)}\n`;
  writeThemeFile(themeDir, insertion.file, comment ? `${comment}\n${body}` : body);
}

/** Inserts text after the opening brace instead of rewriting the file, so Horizon's comments survive. */
function applyAddLocaleNamespace(themeDir: string, insertion: { file: string; namespace: string; translations: Readonly<Record<string, unknown>> }): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is an insertion's own fixed path, not user input
  if (!existsSync(join(themeDir, insertion.file))) throw new InsertionError(`${insertion.file}: file not found`);
  const text = readThemeFile(themeDir, insertion.file);
  const parsed = parseJsonc(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new InsertionError(`${insertion.file}: not a JSON object`);
  if (Object.hasOwn(parsed, insertion.namespace)) throw new InsertionError(`${insertion.file}: namespace exists: ${insertion.namespace}`);

  // Comments are blanked, not removed, so this offset holds in the original text.
  const brace = stripJsonComments(text).indexOf('{');
  const body = JSON.stringify({ [insertion.namespace]: insertion.translations }, null, 2);
  const entry = body.slice(1, -1).trimEnd() + (Object.keys(parsed).length > 0 ? ',' : '\n');
  writeThemeFile(themeDir, insertion.file, `${text.slice(0, brace + 1)}${entry}${text.slice(brace + 1)}`);
}

export function applyInsertion(themeDir: string, insertion: Insertion): void {
  switch (insertion.kind) {
    case 'before-line':
      applyBeforeLine(themeDir, insertion);
      return;
    case 'replace-anchor':
      applyReplaceAnchor(themeDir, insertion);
      return;
    case 'set-theme-settings':
      applySetThemeSettings(themeDir, insertion);
      return;
    case 'append-settings-group':
      applyAppendSettingsGroup(themeDir, insertion);
      return;
    case 'add-section-after':
      applyAddSectionAfter(themeDir, insertion);
      return;
    case 'add-locale-namespace':
      applyAddLocaleNamespace(themeDir, insertion);
      return;
  }
}
