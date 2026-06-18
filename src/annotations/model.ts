export type AnnotationTool = "pan" | "circle" | "highlight" | "arrow" | "text";

export interface Annotation {
  id: string;
  stepId: string;
  kind: Exclude<AnnotationTool, "pan">;
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color: string;
  strokeWidth: number;
  createdAt: string;
}

export interface AnnotationSnapshot {
  version: 1;
  exportedAt: string;
  reports: Array<{
    reportId?: string;
    fileName: string;
    annotations: Annotation[];
    captions: Record<string, string>;
  }>;
}

export interface AnnotationState {
  annotations: Annotation[];
  captions: Record<string, string>;
}
