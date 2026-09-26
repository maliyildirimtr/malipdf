/**
 * Interface language. English is the source language: every string in the
 * app is written in English and translated at display time.
 *
 * Shared by the main process (native menu, dialogs) and the renderer.
 */
import { TR, TR_PATTERNS, TR_WRAPPERS } from './tr';
import { TR_FORMULA } from './trFormula';

export type Language = 'en' | 'tr';
export const LANGUAGES: readonly { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Türkçe' },
];

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'tr';
}

/** Best guess from an OS / browser locale such as "tr-TR". */
export function languageFromLocale(locale: string | undefined | null): Language {
  return typeof locale === 'string' && /^tr\b/i.test(locale) ? 'tr' : 'en';
}

const ELLIPSIS = /(…|\.\.\.)$/;
/** "Undo ink (⌘Z)", "Delete (⌫)", "Pen (D)", "Save (⌘S)" */
const SHORTCUT_SUFFIX = /^(.+?)(\s+\((?:[⌘⌥⇧⌃⌫⎋↩︎]|Esc|Enter|Shift|Space|\d+|[A-Z0-9]\b)[^()]*\))$/;
/** "Insert Note Page… ⌥⌘N" */
const TRAILING_KEYS = /^(.+?)(\s+[⌘⌥⇧⌃][^\s]*)$/;

/** Where a string is shown. Some words mean something else in formulas. */
export type TranslationScope = 'formula';

function exact(text: string, scope: TranslationScope | undefined): string | undefined {
  return (scope === 'formula' ? TR_FORMULA[text] : undefined) ?? TR[text];
}

function lookupCore(text: string, scope?: TranslationScope): string | undefined {
  const hit = exact(text, scope);
  if (hit !== undefined) return hit;

  const ellipsis = ELLIPSIS.exec(text);
  if (ellipsis) {
    const base = exact(text.slice(0, -ellipsis[0].length), scope);
    if (base !== undefined) return base + ellipsis[0];
  }

  for (const [pattern, build] of TR_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return build(...match.slice(1));
  }

  for (const [pattern, build] of TR_WRAPPERS) {
    const match = pattern.exec(text);
    if (match) {
      const [, inner, ...rest] = match;
      return build(lookupCore(inner, scope) ?? inner, ...rest);
    }
  }

  const shortcut = SHORTCUT_SUFFIX.exec(text) ?? TRAILING_KEYS.exec(text);
  if (shortcut) {
    const head = lookupCore(shortcut[1], scope);
    if (head !== undefined) return head + shortcut[2];
  }

  // "Save failed: <reason>" — a known message followed by details.
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const head = exact(text.slice(0, colon), scope);
    if (head !== undefined) return head + text.slice(colon);
  }

  // Formula symbols: "Square root  \\sqrt{x}"
  const gap = text.indexOf('  ');
  if (gap > 0) {
    const head = lookupCore(text.slice(0, gap), scope);
    if (head !== undefined) return head + text.slice(gap);
  }
  return undefined;
}

/**
 * Translate one UI string. Unknown text comes back unchanged, so user
 * content, file names and numbers pass through safely. Leading and trailing
 * whitespace is kept (React splits "Page {n}" into "Page " and "3").
 */
export function translate(language: Language, text: string, scope?: TranslationScope): string {
  if (language === 'en' || !text) return text;
  const hit = lookupCore(text, scope);
  if (hit !== undefined) return hit;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match || !match[2]) return text;
  if (match[1] === '' && match[3] === '' && !/\s{2,}|\n/.test(text)) return text;
  // JSX text that wraps over several source lines keeps its indentation.
  const core = lookupCore(match[2], scope) ?? lookupCore(match[2].replace(/\s+/g, ' '), scope);
  return core === undefined ? text : match[1] + core + match[3];
}

/** Does this language have a translation for the text? (Tests and audits.) */
export function hasTranslation(language: Language, text: string): boolean {
  return language === 'en' || translate(language, text) !== text;
}
