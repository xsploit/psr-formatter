import type { CursorPoint, PsrReport, PsrStep, ReportAsset } from "../types/report";
import { createAssetUrl, makeId } from "./file-utils";

interface StepEvent {
  type: "text" | "image";
  text?: string;
  src?: string;
}

export function buildPsrReport(fileName: string, assets: ReportAsset[]): PsrReport {
  const htmlAssets = assets.filter((asset) => asset.kind === "html");
  const css = assets.filter((asset) => asset.kind === "css");
  const metadataXml = assets.filter((asset) => asset.kind === "xml");
  const sourceHtml = chooseMainHtml(htmlAssets);
  const renderedHtml = rewriteAssetLinks(sourceHtml, assets);
  const document = new DOMParser().parseFromString(sourceHtml || "<main></main>", "text/html");
  const title = readTitle(document, fileName);
  const cursorPoints = extractCursorPoints([sourceHtml, ...metadataXml.map((asset) => asset.text ?? "")].join("\n"));
  const steps = extractStructuredSteps(sourceHtml, assets) ?? extractSteps(document, assets, cursorPoints);

  return {
    id: makeId("report"),
    fileName,
    title,
    createdAt: new Date().toISOString(),
    sourceHtml,
    renderedHtml,
    metadataXml,
    css,
    assets,
    steps
  };
}

export function findAssetByRef(ref: string, assets: ReportAsset[]): ReportAsset | undefined {
  const needle = normalizeRef(ref);

  if (!needle) {
    return undefined;
  }

  return assets.find((asset) => {
    const candidates = [
      asset.contentLocation,
      asset.contentId,
      asset.contentId ? `cid:${asset.contentId}` : undefined,
      asset.name,
      asset.objectUrl
    ];

    return candidates.some((candidate) => {
      const clean = normalizeRef(candidate);
      return clean === needle || basename(clean) === basename(needle);
    });
  });
}

function chooseMainHtml(assets: ReportAsset[]): string {
  const sorted = [...assets].sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
  return sorted[0]?.text ?? "";
}

function rewriteAssetLinks(html: string, assets: ReportAsset[]): string {
  return html.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi, (match, attribute: string, quote: string, value: string) => {
    const asset = findAssetByRef(value, assets);

    if (!asset || (asset.kind !== "image" && asset.kind !== "css")) {
      return match;
    }

    return `${attribute}=${quote}${createAssetUrl(asset)}${quote}`;
  });
}

function readTitle(document: Document, fileName: string): string {
  const title = collapse(document.querySelector("title")?.textContent ?? "");

  if (title) {
    return title;
  }

  const heading = collapse(document.querySelector("h1,h2")?.textContent ?? "");
  return heading || fileName.replace(/\.(mht|mhtml)(?:\.stub)?$/i, "");
}

function extractSteps(document: Document, assets: ReportAsset[], cursorPoints: CursorPoint[]): PsrStep[] {
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  const events = collectEvents(document);
  const steps: PsrStep[] = [];
  let textBuffer: string[] = [];
  let imageIndex = 0;

  for (const event of events) {
    if (event.type === "text" && event.text) {
      textBuffer.push(event.text);
      textBuffer = textBuffer.slice(-6);
      continue;
    }

    if (event.type === "image") {
      const screenshot = findAssetByRef(event.src ?? "", assets) ?? imageAssets[imageIndex];
      const detail = summarizeStepText(textBuffer);
      steps.push(makeStep(steps.length, detail, screenshot?.id, cursorPoints[steps.length]));
      imageIndex += 1;
      textBuffer = [];
    }
  }

  if (!steps.length) {
    const textSteps = events
      .filter((event) => event.type === "text" && event.text && looksLikeAction(event.text))
      .map((event) => event.text as string);

    for (const text of textSteps) {
      steps.push(makeStep(steps.length, summarizeStepText([text]), undefined, cursorPoints[steps.length]));
    }
  }

  if (!steps.length && imageAssets.length) {
    for (const asset of imageAssets) {
      steps.push(makeStep(steps.length, summarizeStepText([]), asset.id, cursorPoints[steps.length]));
    }
  }

  return steps;
}

function extractStructuredSteps(sourceHtml: string, assets: ReportAsset[]): PsrStep[] | undefined {
  const xmlText = sourceHtml.match(/<Report\b[\s\S]*?<\/Report>/i)?.[0];

  if (!xmlText) {
    return undefined;
  }

  const xml = new DOMParser().parseFromString(xmlText, "application/xml");

  if (xml.querySelector("parsererror")) {
    return undefined;
  }

  const actions = Array.from(xml.querySelectorAll("EachAction"));
  const steps = actions.map((action, zeroIndex) => {
    const index = Number(action.getAttribute("ActionNumber")) || zeroIndex + 1;
    const time = action.getAttribute("Time") ?? undefined;
    const description = collapse(action.querySelector("Description")?.textContent ?? "");
    const actionLabel = collapse(action.querySelector("Action")?.textContent ?? "");
    const screenshotName = collapse(action.querySelector("ScreenshotFileName")?.textContent ?? "");
    const cursor = parseCursor(action.querySelector("CursorCoordsXY")?.textContent);
    const screenshot = screenshotName ? findAssetByRef(screenshotName, assets) : undefined;
    const caption = time && description ? `(${time}) ${description}` : description || actionLabel || `Step ${index}`;

    return {
      id: makeId("step"),
      index,
      title: `Step ${index}`,
      action: caption,
      description: [description, actionLabel].filter(Boolean).join("\n"),
      caption,
      screenshotAssetId: screenshot?.id,
      cursor,
      timestamp: time,
      expanded: index <= 3
    };
  });

  return steps.length ? steps : undefined;
}

function parseCursor(value: string | null | undefined): CursorPoint | undefined {
  const match = value?.match(/(-?\d{1,5})\s*,\s*(-?\d{1,5})/);

  if (!match) {
    return undefined;
  }

  const x = Number(match[1]);
  const y = Number(match[2]);

  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    return undefined;
  }

  return { x, y };
}

function collectEvents(document: Document): StepEvent[] {
  const body = document.body;

  if (!body) {
    return [];
  }

  const selector = "h1,h2,h3,h4,h5,p,li,td,th,summary,figcaption,div,span,img";
  const elements = Array.from(body.querySelectorAll<HTMLElement>(selector));
  const events: StepEvent[] = [];
  let previousText = "";

  for (const element of elements) {
    if (element.tagName.toLowerCase() === "img") {
      events.push({ type: "image", src: element.getAttribute("src") ?? "" });
      previousText = "";
      continue;
    }

    if (element.querySelector("img")) {
      continue;
    }

    if (element.querySelector("h1,h2,h3,h4,h5,p,li,td,th,summary,figcaption,div")) {
      continue;
    }

    const text = collapse(element.textContent ?? "");

    if (!text || text.length < 3 || text === previousText || isNavigationNoise(text)) {
      continue;
    }

    events.push({ type: "text", text });
    previousText = text;
  }

  return compactDuplicateEvents(events);
}

function compactDuplicateEvents(events: StepEvent[]): StepEvent[] {
  const compact: StepEvent[] = [];

  for (const event of events) {
    const last = compact[compact.length - 1];

    if (event.type === "text" && last?.type === "text" && event.text === last.text) {
      continue;
    }

    compact.push(event);
  }

  return compact;
}

function summarizeStepText(texts: string[]): { action: string; description: string; timestamp?: string } {
  const useful = texts.map(collapse).filter((text) => text && !isNavigationNoise(text));
  const action = useful.find(looksLikeAction) ?? useful.at(-1) ?? "";
  const description = useful.join("\n");
  const timestamp = useful.join(" ").match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/i)?.[0];

  return {
    action,
    description,
    timestamp
  };
}

function makeStep(
  zeroIndex: number,
  detail: { action: string; description: string; timestamp?: string },
  screenshotAssetId: string | undefined,
  cursor: CursorPoint | undefined
): PsrStep {
  const index = zeroIndex + 1;
  const fallback = `Step ${index}`;
  const action = trimStepPrefix(detail.action) || fallback;

  return {
    id: makeId("step"),
    index,
    title: fallback,
    action,
    description: detail.description || action,
    caption: action,
    screenshotAssetId,
    cursor,
    timestamp: detail.timestamp,
    expanded: index <= 3
  };
}

function looksLikeAction(text: string): boolean {
  return /\b(step|problem step|user action|action|click|double-click|right-click|type|keyboard|select|open|close|drag|scroll|mouse|left button|right button)\b/i.test(
    text
  );
}

function trimStepPrefix(text: string): string {
  return text.replace(/^\s*(?:problem\s+)?step\s+\d+\s*[:.-]?\s*/i, "").trim();
}

function isNavigationNoise(text: string): boolean {
  return /^(next|previous|back|start record|stop record|problem steps recorder|copyright|microsoft|page \d+ of \d+)$/i.test(text);
}

function extractCursorPoints(source: string): CursorPoint[] {
  const points: CursorPoint[] = [];
  const patterns = [
    /\b(?:cursor|mouse)[^<>\n]{0,140}?\b(?:x|left)\D{0,12}(-?\d{1,5})[^<>\n]{0,80}?\b(?:y|top)\D{0,12}(-?\d{1,5})/gi,
    /\b(?:x|left)\s*=\s*["']?(-?\d{1,5})["']?[\s\S]{0,80}?\b(?:y|top)\s*=\s*["']?(-?\d{1,5})["']?/gi,
    /\b(?:cursor|mouse)[^()\n]{0,80}?\((-?\d{1,5})\s*,\s*(-?\d{1,5})\)/gi
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const x = Number(match[1]);
      const y = Number(match[2]);

      if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 20000 && y <= 20000) {
        points.push({ x, y });
      }
    }
  }

  return dedupePoints(points);
}

function dedupePoints(points: CursorPoint[]): CursorPoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x},${point.y}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeRef(value?: string): string {
  if (!value) {
    return "";
  }

  const stripped = value
    .trim()
    .replace(/^cid:/i, "")
    .replace(/^<|>$/g, "")
    .split(/[?#]/)[0]
    .replace(/\\/g, "/");

  try {
    return decodeURIComponent(stripped).toLowerCase();
  } catch {
    return stripped.toLowerCase();
  }
}

function basename(value: string): string {
  return value.split("/").filter(Boolean).pop() ?? value;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
