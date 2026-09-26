/** Insert ▸ Header, Footer & Page Numbers… */
import { activeDocument, mutateDocumentBytes } from './documentBytesCommands';
import { applyPageStamps, type PageStampOptions } from '../pdf/pageStamps';
import { loadExportFonts } from '../pdf/exportFonts';
import { notifyUser } from '../utils/notify';

export async function addPageStamps(options: PageStampOptions): Promise<boolean> {
  const doc = activeDocument();
  if (!doc) return false;
  const fonts = await loadExportFonts();
  const meta = { title: doc.title.replace(/\.pdf$/i, ''), date: new Date().toLocaleDateString() };
  let count = 0;
  const result = await mutateDocumentBytes(doc, async (pdf) => {
    pdf.registerFontkit(fonts.fontkit);
    const font = await pdf.embedFont(await fonts.load('sans', 'regular'), { subset: true });
    count = applyPageStamps(pdf, options, font, meta);
    return count > 0;
  }, 'Could not add the header and footer');
  if (result === null) return false;
  notifyUser('success', `Added to ${count} page${count === 1 ? '' : 's'}. Undo (⌘Z) removes it again.`);
  return true;
}
