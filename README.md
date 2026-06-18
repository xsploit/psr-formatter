# PSR Formatter

A 100% client-side Problem Steps Recorder `.mht` / `.mhtml` formatter for GitHub Pages. Outlook-downloaded `.mht.stub` attachments are accepted without renaming.

## What It Does

- Parses MHTML multipart files in the browser.
- Extracts HTML, screenshots, CSS, XML metadata, action text, and best-effort cursor coordinates.
- Renders a searchable documentation viewer with lazy-loaded screenshots.
- Supports collapsible steps, virtualized thumbnails, editable captions, dark/light mode, print styles, compare mode, and presentation mode.
- Adds canvas annotations: circle, arrow, text, cursor highlight, pan, zoom, undo, and redo.
- Adds translucent highlight annotations and automatic click/cursor marks from PSR metadata.
- Prints clean documentation: all steps expand, editor chrome is hidden, captions and annotated screenshots stay visible.
- Imports and exports annotations as JSON.
- Converts one or many PSR files and packages static HTML, decoded assets, metadata, Markdown, source HTML, and annotations into a ZIP.

No backend is used. Files are read with browser APIs and never leave the page.

## Run Locally

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

The generated `dist/` folder is static and can be hosted on GitHub Pages. `vite.config.ts` uses `base: "./"` so the app works from a project page path.

## Project Layout

```text
psr-formatter/
├── index.html
├── assets/
│   ├── css/
│   ├── js/
│   └── icons/
├── src/
│   ├── annotations/
│   ├── export/
│   ├── parser/
│   ├── types/
│   ├── ui/
│   └── viewer/
└── README.md
```

## Parser Notes

The parser handles multipart MHTML boundaries, folded headers, `base64`, `quoted-printable`, content locations, content IDs, HTML parts, CSS parts, XML parts, and image parts. PSR files vary by Windows version, so action and cursor extraction use conservative heuristics around screenshot order and nearby text/XML metadata.

## GitHub Pages

1. Build with `npm run build`.
2. Publish `dist/` from a Pages workflow, or set Pages to deploy from the build artifact.
3. Open the hosted page and drag `.mht`, `.mhtml`, or `.mht.stub` files into the app.
