import type { PsrReport, ReportAsset } from "../types/report";
import {
  binaryStringToBytes,
  bytesToBinaryString,
  createAssetUrl,
  decodeText,
  extensionForContentType,
  makeId,
  safeFileName
} from "./file-utils";
import { buildPsrReport } from "./psr";

interface MhtmlPart {
  headers: Record<string, string>;
  rawBody: string;
  bytes: Uint8Array;
}

export async function parseMhtmlFile(file: File): Promise<PsrReport> {
  const buffer = await file.arrayBuffer();
  return parseMhtml(buffer, file.name);
}

export function parseMhtml(buffer: ArrayBuffer, fileName: string): PsrReport {
  const source = bytesToBinaryString(new Uint8Array(buffer));
  const boundary = readBoundary(source);

  if (!boundary) {
    throw new Error(`${fileName} does not look like a multipart MHTML file.`);
  }

  const parts = splitParts(source, boundary);
  const assets = parts.map((part, index) => toAsset(part, index));

  for (const asset of assets) {
    if (asset.kind === "image" || asset.kind === "css") {
      createAssetUrl(asset);
    }
  }

  return buildPsrReport(fileName, assets);
}

function readBoundary(source: string): string | undefined {
  const head = source.slice(0, Math.min(source.length, 12000));
  const quoted = head.match(/boundary\s*=\s*"([^"]+)"/i)?.[1];

  if (quoted) {
    return quoted;
  }

  return head.match(/boundary\s*=\s*([^;\r\n]+)/i)?.[1]?.trim();
}

function splitParts(source: string, boundary: string): MhtmlPart[] {
  const delimiter = `--${boundary}`;
  const segments = source.split(delimiter).slice(1);
  const parts: MhtmlPart[] = [];

  for (const segment of segments) {
    if (segment.startsWith("--")) {
      break;
    }

    const normalized = segment.replace(/^\r?\n/, "");
    const separator = findHeaderSeparator(normalized);

    if (!separator) {
      continue;
    }

    const headerText = normalized.slice(0, separator.index);
    const rawBody = normalized.slice(separator.index + separator.length).replace(/\r?\n$/, "");
    const headers = parseHeaders(headerText);
    const bytes = decodeTransfer(rawBody, headers["content-transfer-encoding"]);
    parts.push({ headers, rawBody, bytes });
  }

  return parts;
}

function findHeaderSeparator(value: string): { index: number; length: number } | undefined {
  const crlf = value.indexOf("\r\n\r\n");

  if (crlf >= 0) {
    return { index: crlf, length: 4 };
  }

  const lf = value.indexOf("\n\n");

  if (lf >= 0) {
    return { index: lf, length: 2 };
  }

  return undefined;
}

function parseHeaders(headerText: string): Record<string, string> {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};

  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");

    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }

  return headers;
}

function decodeTransfer(rawBody: string, encodingHeader = ""): Uint8Array {
  const encoding = encodingHeader.toLowerCase().split(";")[0].trim();

  if (encoding === "base64") {
    const clean = rawBody.replace(/\s+/g, "");
    const decoded = atob(clean);
    return binaryStringToBytes(decoded);
  }

  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(rawBody);
  }

  return binaryStringToBytes(rawBody);
}

function decodeQuotedPrintable(value: string): Uint8Array {
  const compact = value.replace(/=\r?\n/g, "");
  const output: number[] = [];

  for (let index = 0; index < compact.length; index += 1) {
    const char = compact[index];

    if (char === "=" && /^[0-9a-f]{2}$/i.test(compact.slice(index + 1, index + 3))) {
      output.push(Number.parseInt(compact.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    output.push(compact.charCodeAt(index) & 0xff);
  }

  return new Uint8Array(output);
}

function toAsset(part: MhtmlPart, index: number): ReportAsset {
  const contentType = cleanContentType(part.headers["content-type"] ?? "application/octet-stream");
  const contentLocation = stripHeaderBrackets(part.headers["content-location"]);
  const contentId = stripHeaderBrackets(part.headers["content-id"]);
  const name = safeFileName(readPartName(contentLocation, contentId, contentType, index));
  const kind = readKind(contentType, name);
  const text = kind === "html" || kind === "css" || kind === "xml" ? decodeText(part.bytes, contentType) : undefined;

  return {
    id: makeId("asset"),
    kind,
    name,
    contentType,
    contentLocation,
    contentId,
    transferEncoding: part.headers["content-transfer-encoding"],
    bytes: part.bytes,
    text
  };
}

function cleanContentType(contentType: string): string {
  return contentType.split("\n")[0].trim() || "application/octet-stream";
}

function stripHeaderBrackets(value?: string): string | undefined {
  const clean = value?.trim();

  if (!clean) {
    return undefined;
  }

  return clean.replace(/^<|>$/g, "");
}

function readPartName(contentLocation: string | undefined, contentId: string | undefined, contentType: string, index: number): string {
  const source = contentLocation ?? contentId;

  if (source) {
    const withoutQuery = source.split(/[?#]/)[0];
    const normalized = withoutQuery.replace(/\\/g, "/");
    const leaf = normalized.split("/").filter(Boolean).pop();

    if (leaf) {
      return leaf;
    }
  }

  return `part-${String(index + 1).padStart(3, "0")}.${extensionForContentType(contentType)}`;
}

function readKind(contentType: string, name: string): ReportAsset["kind"] {
  const type = contentType.toLowerCase().split(";")[0].trim();
  const lowerName = name.toLowerCase();

  if (type === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return "html";
  }

  if (type === "text/css" || lowerName.endsWith(".css")) {
    return "css";
  }

  if (type.includes("xml") || lowerName.endsWith(".xml")) {
    return "xml";
  }

  if (type.startsWith("image/")) {
    return "image";
  }

  return "other";
}
