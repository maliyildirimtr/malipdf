import { FONT_GROUP_LABELS, TEXT_FONT_FAMILIES, type FontGroup } from '../../pdf/fontFamilies';

const GROUPS: FontGroup[] = ['sans', 'serif', 'mono'];

/** <option>s for a font-family <select>, grouped as sans-serif / serif / monospace. */
export function FontFamilyOptions() {
  return (
    <>
      {GROUPS.map((group) => (
        <optgroup key={group} label={FONT_GROUP_LABELS[group]}>
          {TEXT_FONT_FAMILIES.filter((font) => font.group === group).map((font) => (
            <option key={font.key} value={font.css}>{font.label}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
