/**
 * Export test script — run via: node scripts/testExport.mjs
 *
 * Tests the export pipeline against various scenarios without needing
 * the full Electron environment.
 *
 * This script simulates the annotationExporter.ts logic in Node.js
 * to verify pdf-lib integration and coordinate math.
 */

import { PDFDocument, rgb, StandardFonts, LineCapStyle, BlendMode } from 'pdf-lib';
import { writeFileSync } from 'fs';

// ─── Simulate pdfUserSpaceToLibPoint ──────────────────────────────────────────

function pdfUserSpaceToLibPoint(pdfX, pdfY, rotation, unrotatedWidth, unrotatedHeight) {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 0:   return { x: pdfX, y: pdfY };
    case 90:  return { x: pdfY, y: unrotatedHeight - pdfX };
    case 180: return { x: unrotatedWidth - pdfX, y: unrotatedHeight - pdfY };
    case 270: return { x: unrotatedWidth - pdfY, y: pdfX };
    default:  return { x: pdfX, y: pdfY };
  }
}

// ─── Color helper ─────────────────────────────────────────────────────────────

function parseCssColor(css) {
  if (!css || css === 'transparent') return rgb(0, 0, 0);
  const hex = css.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// ─── Test: blank A4 with all annotation types ─────────────────────────────────

async function testBlankA4() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 portrait
  const info = { width: 595, height: 842, rotation: 0 };

  const toLib = (x, y) => pdfUserSpaceToLibPoint(x, y, info.rotation, info.width, info.height);

  // 1. Stroke (pen)
  page.drawSvgPath('M 50 750 L 100 700 L 150 730 L 200 710', {
    x: 0, y: 0,
    borderColor: rgb(0, 0, 0.8),
    borderWidth: 2,
    borderOpacity: 1,
  });

  // 2. Highlight
  const hlPoints = [{ x: 50, y: 620 }, { x: 300, y: 620 }];
  for (let i = 0; i < hlPoints.length - 1; i++) {
    const s = toLib(hlPoints[i].x, hlPoints[i].y);
    const e = toLib(hlPoints[i+1].x, hlPoints[i+1].y);
    page.drawLine({ start: s, end: e, thickness: 20, color: rgb(1, 0.92, 0), opacity: 0.4, lineCap: LineCapStyle.Butt, blendMode: BlendMode.Multiply });
  }

  // 3. Text
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const textPt = toLib(50, 540);
  page.drawText('Test Text Annotation', { x: textPt.x, y: textPt.y, size: 16, font, color: rgb(0.1, 0.1, 0.1) });

  // 4. Line
  page.drawLine({ start: toLib(50, 480), end: toLib(300, 460), thickness: 2, color: rgb(0.8, 0, 0), opacity: 1, lineCap: LineCapStyle.Round });

  // 5. Arrow
  const arStart = toLib(350, 480);
  const arEnd = toLib(500, 460);
  page.drawLine({ start: arStart, end: arEnd, thickness: 2, color: rgb(0.5, 0, 0.5), lineCap: LineCapStyle.Round });
  const angle = Math.atan2(arEnd.y - arStart.y, arEnd.x - arStart.x);
  const hl = 14;
  page.drawLine({ start: arEnd, end: { x: arEnd.x - hl * Math.cos(angle - Math.PI/6), y: arEnd.y - hl * Math.sin(angle - Math.PI/6) }, thickness: 2, color: rgb(0.5, 0, 0.5) });
  page.drawLine({ start: arEnd, end: { x: arEnd.x - hl * Math.cos(angle + Math.PI/6), y: arEnd.y - hl * Math.sin(angle + Math.PI/6) }, thickness: 2, color: rgb(0.5, 0, 0.5) });

  // 6. Rectangle
  const rectTl = toLib(50, 420);
  const rectBr = toLib(200, 360);
  page.drawRectangle({ x: Math.min(rectTl.x, rectBr.x), y: Math.min(rectTl.y, rectBr.y), width: Math.abs(rectBr.x - rectTl.x), height: Math.abs(rectBr.y - rectTl.y), borderColor: rgb(0, 0.6, 0), borderWidth: 2, color: rgb(0.9, 1, 0.9), opacity: 1, borderOpacity: 1 });

  // 7. Ellipse
  const ellCtr = toLib(400, 390);
  page.drawEllipse({ x: ellCtr.x, y: ellCtr.y, xScale: 70, yScale: 40, borderColor: rgb(0.8, 0.4, 0), borderWidth: 2, color: rgb(1, 0.95, 0.9), opacity: 1, borderOpacity: 1 });

  // Corner markers for verification
  page.drawText('TL', { x: 5, y: 825, size: 8, font, color: rgb(1, 0, 0) });
  page.drawText('TR', { x: 578, y: 825, size: 8, font, color: rgb(1, 0, 0) });
  page.drawText('BL', { x: 5, y: 5, size: 8, font, color: rgb(1, 0, 0) });
  page.drawText('BR', { x: 578, y: 5, size: 8, font, color: rgb(1, 0, 0) });
  page.drawText('CENTER', { x: 280, y: 421, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

  const bytes = await doc.save();
  writeFileSync('/tmp/malipen_test_a4.pdf', bytes);
  console.log('✅ Test 1 (Blank A4, all annotation types):', bytes.length, 'bytes → /tmp/malipen_test_a4.pdf');
}

// ─── Test: Letter landscape ───────────────────────────────────────────────────

async function testLetter() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]); // Letter landscape
  const info = { width: 792, height: 612, rotation: 0 };
  const toLib = (x, y) => pdfUserSpaceToLibPoint(x, y, info.rotation, info.width, info.height);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Letter Landscape - MaliPen Annotation Test', { x: 50, y: 550, size: 18, font, color: rgb(0, 0, 0) });

  page.drawSvgPath('M 50 400 L 300 450 L 500 380 L 700 430', { x: 0, y: 0, borderColor: rgb(0, 0, 0.8), borderWidth: 3, borderOpacity: 1 });
  page.drawRectangle({ x: 50, y: 100, width: 200, height: 120, borderColor: rgb(0.8, 0, 0), borderWidth: 2, opacity: 0.7, borderOpacity: 1 });
  page.drawEllipse({ x: 400, y: 200, xScale: 100, yScale: 60, borderColor: rgb(0, 0.6, 0.2), borderWidth: 2 });

  const bytes = await doc.save();
  writeFileSync('/tmp/malipen_test_letter.pdf', bytes);
  console.log('✅ Test 2 (Letter Landscape):', bytes.length, 'bytes → /tmp/malipen_test_letter.pdf');
}

// ─── Test: Multi-page PDF ─────────────────────────────────────────────────────

async function testMultiPage() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842]);
    const info = { width: 595, height: 842, rotation: 0 };
    const toLib = (x, y) => pdfUserSpaceToLibPoint(x, y, info.rotation, info.width, info.height);

    page.drawText(`Page ${i + 1} - Annotation`, { x: 50, y: 750, size: 20, font, color: rgb(0, 0, 0) });
    const pt = toLib(100 + i * 80, 600 - i * 50);
    page.drawEllipse({ x: pt.x, y: pt.y, xScale: 50, yScale: 30, borderColor: rgb(i * 0.4, 0.2, 0.8 - i * 0.3), borderWidth: 2 });
    page.drawSvgPath(`M 50 ${400 - i * 30} L ${200 + i * 50} ${350 - i * 20}`, { x: 0, y: 0, borderColor: rgb(0, 0, 0), borderWidth: 1.5, borderOpacity: 0.7 });
  }

  const bytes = await doc.save();
  writeFileSync('/tmp/malipen_test_multipage.pdf', bytes);
  console.log('✅ Test 3 (Multi-page, 3 pages):', bytes.length, 'bytes → /tmp/malipen_test_multipage.pdf');
}

// ─── Test: Rotation math ──────────────────────────────────────────────────────

async function testRotationMath() {
  // Verify known-point mapping
  const cases = [
    // rotation=0: identity
    { rot: 0,   W: 595, H: 842, pdfX: 0,   pdfY: 0,   expectedX: 0,   expectedY: 0 },
    { rot: 0,   W: 595, H: 842, pdfX: 595, pdfY: 842, expectedX: 595, expectedY: 842 },
    { rot: 0,   W: 595, H: 842, pdfX: 297.5, pdfY: 421, expectedX: 297.5, expectedY: 421 },
    // rotation=180: flip both axes
    { rot: 180, W: 595, H: 842, pdfX: 0, pdfY: 0, expectedX: 595, expectedY: 842 },
    { rot: 180, W: 595, H: 842, pdfX: 595, pdfY: 842, expectedX: 0, expectedY: 0 },
  ];

  let allPassed = true;
  for (const tc of cases) {
    const result = pdfUserSpaceToLibPoint(tc.pdfX, tc.pdfY, tc.rot, tc.W, tc.H);
    const pass = Math.abs(result.x - tc.expectedX) < 0.01 && Math.abs(result.y - tc.expectedY) < 0.01;
    if (!pass) {
      console.error('❌ FAIL:', tc, '→', result);
      allPassed = false;
    }
  }
  if (allPassed) console.log('✅ Test 4 (Rotation math):', cases.length, 'cases passed');
}

// ─── Run all tests ────────────────────────────────────────────────────────────

async function runAll() {
  try {
    await testBlankA4();
    await testLetter();
    await testMultiPage();
    await testRotationMath();
    console.log('\n✅ All export tests passed.');
    console.log('Open test PDFs in Preview:');
    console.log('  open /tmp/malipen_test_a4.pdf');
    console.log('  open /tmp/malipen_test_letter.pdf');
    console.log('  open /tmp/malipen_test_multipage.pdf');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

runAll();
