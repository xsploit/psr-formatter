export type AssetKind = "html" | "css" | "xml" | "image" | "other";

export interface ReportAsset {
  id: string;
  kind: AssetKind;
  name: string;
  contentType: string;
  contentLocation?: string;
  contentId?: string;
  transferEncoding?: string;
  bytes: Uint8Array;
  text?: string;
  objectUrl?: string;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export interface PsrStep {
  id: string;
  index: number;
  title: string;
  action: string;
  description: string;
  caption: string;
  screenshotAssetId?: string;
  cursor?: CursorPoint;
  timestamp?: string;
  expanded: boolean;
}

export interface PsrReport {
  id: string;
  fileName: string;
  title: string;
  createdAt: string;
  sourceHtml: string;
  renderedHtml: string;
  metadataXml: ReportAsset[];
  css: ReportAsset[];
  assets: ReportAsset[];
  steps: PsrStep[];
}

export interface ParserDiagnostics {
  fileName: string;
  warnings: string[];
}
