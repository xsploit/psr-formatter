import JSZip from "jszip";
import type { Annotation, AnnotationSnapshot, AnnotationState } from "../annotations/model";
import type { AnnotationStore } from "../annotations/store";
import { assetToDataUrl, safeFileName } from "../parser/file-utils";
import type { CursorPoint, PsrReport, ReportAsset } from "../types/report";
import { renderMarkdown } from "./markdown";

interface AssetPathMap {
  paths: Map<string, string>;
  dimensions: Map<string, { width: number; height: number }>;
}

export async function createReportsZip(reports: PsrReport[], store: AnnotationStore): Promise<Blob> {
  const zip = new JSZip();
  const snapshot = store.toSnapshot(reports);
  zip.file("annotations.json", JSON.stringify(snapshot, null, 2));
  zip.file("index.html", renderBatchIndex(reports));

  for (const report of reports) {
    const folderName = safeFileName(report.fileName.replace(/\.(mht|mhtml)(?:\.stub)?$/i, ""), "report");
    const folder = zip.folder(folderName) ?? zip;
    const map = await addReportAssets(folder, report);
    const state = store.getState(report.id);

    folder.file("index.html", renderStaticReport(report, state, map));
    folder.file("report.md", renderMarkdown(report, store));
    folder.file("source.html", report.sourceHtml);
    folder.file("annotations.json", JSON.stringify(reportSnapshot(report, state), null, 2));

    for (const css of report.css) {
      folder.file(`css/${safeFileName(css.name)}`, css.text ?? "");
    }

    for (const xml of report.metadataXml) {
      folder.file(`metadata/${safeFileName(xml.name)}`, xml.text ?? "");
    }
  }

  return zip.generateAsync({ type: "blob" });
}

async function addReportAssets(folder: JSZip, report: PsrReport): Promise<AssetPathMap> {
  const paths = new Map<string, string>();
  const dimensions = new Map<string, { width: number; height: number }>();
  const usedNames = new Set<string>();

  for (const asset of report.assets.filter((item) => item.kind === "image")) {
    const name = uniqueName(safeFileName(asset.name), usedNames);
    const path = `assets/${name}`;
    paths.set(asset.id, path);
    folder.file(path, asset.bytes);
    dimensions.set(asset.id, await readImageDimensions(asset));
  }

  return { paths, dimensions };
}

function reportSnapshot(report: PsrReport, state: AnnotationState): AnnotationSnapshot {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    reports: [
      {
        reportId: report.id,
        fileName: report.fileName,
        annotations: state.annotations,
        captions: state.captions
      }
    ]
  };
}

function renderBatchIndex(reports: PsrReport[]): string {
  const links = reports
    .map((report) => {
      const folderName = safeFileName(report.fileName.replace(/\.(mht|mhtml)(?:\.stub)?$/i, ""), "report");
      return `<li><a href="./${encodeURI(folderName)}/index.html">${escapeHtml(report.title)}</a></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PSR Reports</title>
<style>
body{font-family:system-ui,sans-serif;margin:3rem;background:#f7f5ef;color:#1f2a2e}
a{color:#0b6f7a}
main{max-width:760px;margin:auto}
li{margin:.65rem 0}
</style>
</head>
<body><main><h1>PSR Reports</h1><ol>${links}</ol></main></body>
</html>`;
}

function renderStaticReport(report: PsrReport, state: AnnotationState, map: AssetPathMap): string {
  const steps = report.steps
    .map((step) => {
      const screenshot = report.assets.find((asset) => asset.id === step.screenshotAssetId);
      const caption = state.captions[step.id] ?? step.caption;
      const annotations = state.annotations.filter((annotation) => annotation.stepId === step.id);
      const imagePath = screenshot ? map.paths.get(screenshot.id) : undefined;
      const dimensions = screenshot ? map.dimensions.get(screenshot.id) : undefined;
      const media = screenshot && imagePath && dimensions
        ? `<figure class="shot">
            <div class="image-wrap">
              <img src="${escapeAttribute(imagePath)}" alt="${escapeAttribute(caption)}">
              ${renderSvgOverlay(dimensions.width, dimensions.height, annotations, step.cursor)}
            </div>
            <figcaption>${escapeHtml(caption)}</figcaption>
          </figure>`
        : "";

      return `<article class="step">
        <h2>Step ${step.index}</h2>
        <p class="action">${escapeHtml(caption)}</p>
        ${step.timestamp ? `<p class="meta">${escapeHtml(step.timestamp)}</p>` : ""}
        ${step.description && step.description !== caption ? `<p>${escapeHtml(step.description)}</p>` : ""}
        ${media}
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
:root{color-scheme:light;--bg:#f7f5ef;--ink:#1f2a2e;--muted:#65727a;--line:#d8d0c2;--accent:#0b6f7a}
body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;margin:0;background:var(--bg);color:var(--ink)}
header{padding:2rem clamp(1rem,4vw,4rem);border-bottom:1px solid var(--line);background:#fffdf8}
main{max-width:1060px;margin:auto;padding:1.5rem clamp(1rem,4vw,3rem)}
h1{font-size:clamp(1.7rem,4vw,3rem);margin:0 0 .5rem}
.meta{color:var(--muted);font-size:.92rem}
.step{break-inside:avoid;border-bottom:1px solid var(--line);padding:1.5rem 0}
.action{font-weight:700}
.shot{margin:1rem 0 0}
.image-wrap{position:relative;display:inline-block;max-width:100%;background:#111}
.image-wrap img{display:block;max-width:100%;height:auto}
.image-wrap svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
figcaption{color:var(--muted);margin-top:.45rem}
@media print{body{background:#fff}header{padding:0 0 1rem}.step{page-break-inside:avoid}main{padding:0;max-width:none}}
</style>
</head>
<body>
<header><h1>${escapeHtml(report.title)}</h1><p class="meta">${escapeHtml(report.fileName)} · ${report.steps.length} steps</p></header>
<main>${steps}</main>
</body>
</html>`;
}

function renderSvgOverlay(width: number, height: number, annotations: Annotation[], cursor?: CursorPoint): string {
  const cursorMarkup = cursor
    ? `<circle cx="${cursor.x}" cy="${cursor.y}" r="22" fill="none" stroke="rgba(226,65,65,.9)" stroke-width="4" stroke-dasharray="8 6"/>
<path d="M ${cursor.x - 32} ${cursor.y} L ${cursor.x + 32} ${cursor.y} M ${cursor.x} ${cursor.y - 32} L ${cursor.x} ${cursor.y + 32}" stroke="rgba(226,65,65,.9)" stroke-width="4"/>`
    : "";
  const annotationMarkup = annotations.map(renderAnnotationSvg).join("");
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${cursorMarkup}${annotationMarkup}</svg>`;
}

function renderAnnotationSvg(annotation: Annotation): string {
  const color = escapeAttribute(annotation.color);
  const strokeWidth = annotation.strokeWidth;

  if (annotation.kind === "highlight") {
    const width = annotation.width ?? 0;
    const height = annotation.height ?? 0;
    return `<ellipse cx="${annotation.x + width / 2}" cy="${annotation.y + height / 2}" rx="${Math.max(width / 2, 1)}" ry="${Math.max(
      height / 2,
      1
    )}" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }

  if (annotation.kind === "circle") {
    const width = annotation.width ?? 0;
    const height = annotation.height ?? 0;
    return `<ellipse cx="${annotation.x + width / 2}" cy="${annotation.y + height / 2}" rx="${Math.max(width / 2, 1)}" ry="${Math.max(
      height / 2,
      1
    )}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>`;
  }

  if (annotation.kind === "arrow") {
    const x2 = annotation.x2 ?? annotation.x;
    const y2 = annotation.y2 ?? annotation.y;
    const angle = Math.atan2(y2 - annotation.y, x2 - annotation.x);
    const head = 18;
    const p1 = `${x2 - head * Math.cos(angle - Math.PI / 7)},${y2 - head * Math.sin(angle - Math.PI / 7)}`;
    const p2 = `${x2 - head * Math.cos(angle + Math.PI / 7)},${y2 - head * Math.sin(angle + Math.PI / 7)}`;
    return `<line x1="${annotation.x}" y1="${annotation.y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>
<polygon points="${x2},${y2} ${p1} ${p2}" fill="${color}"/>`;
  }

  return `<text x="${annotation.x}" y="${annotation.y}" fill="${color}" stroke="rgba(255,255,255,.88)" stroke-width="${
    strokeWidth + 2
  }" paint-order="stroke" font-family="system-ui,sans-serif" font-size="${Math.max(18, strokeWidth * 7)}" font-weight="700">${escapeHtml(
    annotation.text ?? ""
  )}</text>`;
}

function readImageDimensions(asset: ReportAsset): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1000, height: image.naturalHeight || 700 });
    image.onerror = () => resolve({ width: 1000, height: 700 });
    image.src = asset.objectUrl ?? assetToDataUrl(asset);
  });
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let counter = 2;
  let candidate = `${stem}-${counter}${extension}`;

  while (used.has(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${extension}`;
  }

  used.add(candidate);
  return candidate;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const escapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return escapes[char];
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
