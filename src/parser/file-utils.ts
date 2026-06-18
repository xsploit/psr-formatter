import type { ReportAsset } from "../types/report";

export function makeId(prefix: string): string {
  if ("randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function safeFileName(value: string, fallback = "file"): string {
  const clean = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");

  return clean || fallback;
}

export function extensionForContentType(contentType: string): string {
  const type = contentType.toLowerCase().split(";")[0].trim();
  const known: Record<string, string> = {
    "text/html": "html",
    "text/css": "css",
    "text/xml": "xml",
    "application/xml": "xml",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/json": "json"
  };

  return known[type] ?? "bin";
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    result += String.fromCharCode(...chunk);
  }

  return result;
}

export function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }

  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(result);
}

export function assetToDataUrl(asset: ReportAsset): string {
  return `data:${asset.contentType || "application/octet-stream"};base64,${bytesToBase64(asset.bytes)}`;
}

export function decodeText(bytes: Uint8Array, contentType = ""): string {
  const charset = contentType.match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? "utf-8";
  const normalized = normalizeCharset(charset);

  try {
    return new TextDecoder(normalized).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function normalizeCharset(charset: string): string {
  const lower = charset.toLowerCase();

  if (lower === "unicode" || lower === "utf16") {
    return "utf-16le";
  }

  if (lower === "iso-8859-1" || lower === "latin1") {
    return "windows-1252";
  }

  return lower;
}

export function createAssetUrl(asset: ReportAsset): string {
  if (!asset.objectUrl) {
    asset.objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(asset.bytes)], { type: asset.contentType }));
  }

  return asset.objectUrl;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = safeFileName(fileName, "download");
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
