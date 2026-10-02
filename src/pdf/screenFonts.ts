/**
 * Puts the bundled text fonts on screen.
 *
 * Families with a `face` (Carlito, Poppins, …) are not installed on the
 * user's system, so each face is registered with document.fonts from the
 * bundled bytes the first time text needs it. Canvas text does not wait for
 * fonts, so FONTS_LOADED_EVENT tells the canvases to draw again once a face is
 * ready. Without a DOM (tests) this does nothing.
 */
import { TEXT_FONT_FAMILIES, fontFamilyInfo, fontFamilyKey, fontStyleKey, type FontFamilyKey, type FontStyleKey } from './fontFamilies';

export const FONTS_LOADED_EVENT = 'malipdf:fonts-loaded';

const STYLES: FontStyleKey[] = ['regular', 'bold', 'italic', 'boldItalic'];
const started = new Set<string>();

function supported(): boolean {
  return typeof document !== 'undefined' && typeof FontFace !== 'undefined' && !!document.fonts;
}

function loadFace(key: FontFamilyKey, style: FontStyleKey): void {
  const face = fontFamilyInfo(key).face;
  const id = `${key}:${style}`;
  if (!face || started.has(id) || !supported()) return;
  started.add(id);
  void (async () => {
    try {
      const { loadFontBytes } = await import('./exportFonts');
      const bytes = await loadFontBytes(key, style);
      const font = new FontFace(face, bytes as BufferSource, {
        weight: style === 'bold' || style === 'boldItalic' ? '700' : '400',
        style: style === 'italic' || style === 'boldItalic' ? 'italic' : 'normal',
      });
      await font.load();
      document.fonts.add(font);
      window.dispatchEvent(new Event(FONTS_LOADED_EVENT));
    } catch (error) {
      started.delete(id);
      console.warn(`[Fonts] Could not load ${face} (${style}):`, error);
    }
  })();
}

/** Make sure the face used by this text is (being) loaded. Cheap to call often. */
export function requestScreenFont(fontFamily: string | undefined, bold = false, italic = false): void {
  if (!supported()) return;
  loadFace(fontFamilyKey(fontFamily), fontStyleKey(!!bold, !!italic));
}

/** Load all four styles of a family (e.g. when it is picked in a menu). */
export function requestScreenFontFamily(fontFamily: string | undefined): void {
  if (!supported()) return;
  const key = fontFamilyKey(fontFamily);
  for (const style of STYLES) loadFace(key, style);
}

/** Load every bundled family (e.g. when the font menu is opened). */
export function requestAllScreenFonts(): void {
  if (!supported()) return;
  for (const family of TEXT_FONT_FAMILIES) if (family.face) loadFace(family.key, 'regular');
}
