import { describe, expect, it } from 'vitest';
import { hasTranslation, isLanguage, languageFromLocale, translate } from '../../../electron/i18n';
import { APP_COMMANDS } from '../../commands/commandRegistry';
import { createNativeMenuSchema, type NativeMenuNode } from '../../../electron/nativeMenuSchema';

describe('translate', () => {
  it('leaves English and unknown text alone', () => {
    expect(translate('en', 'Save')).toBe('Save');
    expect(translate('tr', 'Lecture 3 — Thermodynamics.pdf')).toBe('Lecture 3 — Thermodynamics.pdf');
    expect(translate('tr', '')).toBe('');
  });

  it('translates exact strings and keeps the ellipsis', () => {
    expect(translate('tr', 'Save')).toBe('Kaydet');
    expect(translate('tr', 'Open…')).toBe('Aç…');
    expect(translate('tr', 'Save As…')).toBe('Farklı Kaydet…');
  });

  it('keeps surrounding whitespace (React splits text around values)', () => {
    expect(translate('tr', 'Page ')).toBe('Sayfa ');
    expect(translate('tr', ' of ')).toBe(' / ');
  });

  it('translates a label followed by its shortcut', () => {
    expect(translate('tr', 'Undo (⌘Z)')).toBe('Geri Al (⌘Z)');
    expect(translate('tr', 'Pen (P)')).toBe('Kalem (P)');
    expect(translate('tr', 'Split Document… ⌥⌘S')).toBe('Belgeyi Böl… ⌥⌘S');
    expect(translate('tr', 'All (33)')).toBe('Tümü (33)');
  });

  it('fills in numbers and names', () => {
    expect(translate('tr', 'Page 3 of 12')).toBe('Sayfa 3 / 12');
    expect(translate('tr', 'Saved 1 image.')).toBe('1 görsel kaydedildi.');
    expect(translate('tr', 'Saved 4 PDFs.')).toBe('4 PDF kaydedildi.');
    expect(translate('tr', 'Added to 12 pages. Undo (⌘Z) removes it again.')).toBe('12 sayfaya eklendi. Geri Al (⌘Z) tekrar kaldırır.');
    expect(translate('tr', 'Save changes to "Notes.pdf" before closing?')).toBe('"Notes.pdf" kapatılmadan önce değişiklikler kaydedilsin mi?');
    expect(translate('tr', 'Note: buy milk')).toBe('Not: buy milk');
  });

  it('joins JSX text that wraps over several lines', () => {
    expect(translate('tr', '\n   Pages per\n   file\n ')).toBe('\n   Dosya başına sayfa\n ');
  });

  it('uses formula names only inside the formula ribbon', () => {
    expect(translate('tr', 'Cancel')).toBe('İptal');
    expect(translate('tr', 'Cancel', 'formula')).toBe('Sadeleştir');
    expect(translate('tr', 'Square root  \\sqrt{x}', 'formula')).toBe('Karekök  \\sqrt{x}');
  });

  it('translates wrapped messages', () => {
    expect(translate('tr', 'Active tool: Pen')).toBe('Etkin araç: Kalem');
    expect(translate('tr', 'Save failed: disk full')).toBe('Kaydetme başarısız: disk full');
    expect(translate('tr', 'Close All is not available yet')).toBe('Tümünü Kapat henüz kullanılamıyor');
  });

  it('knows the languages', () => {
    expect(isLanguage('tr')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(languageFromLocale('tr-TR')).toBe('tr');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
  });

  it('has Turkish for every command and menu label', () => {
    const missing: string[] = [];
    for (const command of Object.values(APP_COMMANDS)) {
      if (!hasTranslation('tr', command.label)) missing.push(command.label);
    }
    const visit = (items: readonly NativeMenuNode[]) => {
      for (const item of items) {
        if ((item.kind === 'command' || item.kind === 'label' || item.kind === 'submenu') && !hasTranslation('tr', item.label) && item.label !== 'MaliPDF') missing.push(item.label);
        if (item.kind === 'submenu') visit(item.items);
      }
    };
    for (const menu of [...createNativeMenuSchema(true, true), ...createNativeMenuSchema(false, true)]) {
      if (menu.label !== 'MaliPDF' && !hasTranslation('tr', menu.label)) missing.push(menu.label);
      visit(menu.items);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
