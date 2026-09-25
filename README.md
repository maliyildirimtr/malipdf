# MaliPDF

**MaliPDF** is a cross-platform PDF annotation and teaching application designed for students, educators, engineers, researchers, and anyone who works intensively with documents.

The goal is to provide a fast, focused desktop workflow for reading, annotating, teaching from, and organizing PDF-based material.

> MaliPDF is currently under active development and is not yet considered a final production release.

## Features

- PDF viewing and navigation
- Pen and pressure-sensitive drawing
- Highlighter and eraser tools
- Lines, rectangles, ellipses, triangles, and polygons
- Text annotations
- Annotation selection, movement, resizing, and properties
- Images and screenshots inside documents
- Undo / redo history
- Multi-document tabs
- Page zoom and fit modes
- PDF printout insertion
- PowerPoint-to-printout workflow
- Annotation-aware PDF export
- Teaching and visual note workflows
- Keyboard shortcuts and native desktop integration

MaliPDF is being designed with a cross-platform architecture and is not intended to remain limited to only macOS and Windows.

## Why MaliPDF?

MaliPDF is built around a simple idea:

**Your PDFs should feel like an active workspace, not a static document viewer.**

It is especially intended for workflows such as:

- Lecture slides
- Engineering notes
- Technical documents
- Problem solving
- Teaching and presentations
- Research papers
- Visual note-taking
- Document review

## Technology

MaliPDF is primarily built with:

- Electron
- React
- TypeScript
- Vite
- PDF.js
- pdf-lib
- Zustand
- HTML Canvas

The application uses PDF user-space coordinates internally so annotations remain independent from screen resolution, zoom level, and viewport size.

## Repository Structure

```text
malipdf/
├── electron/
├── scripts/
├── src/
├── website/
├── package.json
├── package-lock.json
└── README.md
