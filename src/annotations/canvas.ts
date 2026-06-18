import { makeId } from "../parser/file-utils";
import type { CursorPoint } from "../types/report";
import type { Annotation, AnnotationTool } from "./model";
import type { AnnotationStore } from "./store";

interface AnnotationLayerOptions {
  reportId: string;
  stepId: string;
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  frame: HTMLElement;
  cursor?: CursorPoint;
  store: AnnotationStore;
  getTool: () => AnnotationTool;
  getColor: () => string;
  getStrokeWidth: () => number;
  onPan: (deltaX: number, deltaY: number) => void;
}

interface Draft {
  kind: Annotation["kind"];
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export class AnnotationLayer {
  private readonly context: CanvasRenderingContext2D;
  private draft?: Draft;
  private panStart?: { x: number; y: number };
  private cleanupStore: () => void;

  constructor(private readonly options: AnnotationLayerOptions) {
    const context = options.canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    this.context = context;
    this.cleanupStore = options.store.subscribe(() => this.draw());
    this.bind();
    this.resize();
  }

  destroy(): void {
    this.cleanupStore();
  }

  resize(): void {
    const width = this.options.image.naturalWidth || this.options.image.clientWidth || 1;
    const height = this.options.image.naturalHeight || this.options.image.clientHeight || 1;
    this.options.canvas.width = width;
    this.options.canvas.height = height;
    this.options.canvas.style.width = `${width}px`;
    this.options.canvas.style.height = `${height}px`;
    this.draw();
  }

  draw(): void {
    const { canvas } = this.options;
    this.context.clearRect(0, 0, canvas.width, canvas.height);

    if (this.options.cursor) {
      this.drawCursor(this.options.cursor);
    }

    for (const annotation of this.options.store.getAnnotations(this.options.reportId, this.options.stepId)) {
      this.drawAnnotation(annotation);
    }

    if (this.draft) {
      this.drawDraft(this.draft);
    }
  }

  private bind(): void {
    this.options.image.addEventListener("load", () => this.resize(), { once: true });
    this.options.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.options.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.options.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.options.canvas.addEventListener("pointercancel", () => this.cancel());
  }

  private onPointerDown(event: PointerEvent): void {
    const tool = this.options.getTool();
    this.options.canvas.setPointerCapture(event.pointerId);

    if (tool === "pan") {
      this.panStart = { x: event.clientX, y: event.clientY };
      return;
    }

    const point = this.toCanvasPoint(event);

    if (tool === "text") {
      const text = window.prompt("Text");

      if (text?.trim()) {
        this.options.store.addAnnotation(this.options.reportId, {
          id: makeId("annotation"),
          stepId: this.options.stepId,
          kind: "text",
          x: point.x,
          y: point.y,
          text: text.trim(),
          color: this.options.getColor(),
          strokeWidth: this.options.getStrokeWidth(),
          createdAt: new Date().toISOString()
        });
      }

      return;
    }

    this.draft = {
      kind: tool,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y
    };
    this.draw();
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.panStart) {
      this.options.onPan(event.clientX - this.panStart.x, event.clientY - this.panStart.y);
      this.panStart = { x: event.clientX, y: event.clientY };
      return;
    }

    if (!this.draft) {
      return;
    }

    const point = this.toCanvasPoint(event);
    this.draft.currentX = point.x;
    this.draft.currentY = point.y;
    this.draw();
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.panStart) {
      this.panStart = undefined;
      return;
    }

    if (!this.draft) {
      return;
    }

    const draft = this.draft;
    this.draft = undefined;
    const width = draft.currentX - draft.startX;
    const height = draft.currentY - draft.startY;

    if (Math.abs(width) < 4 && Math.abs(height) < 4) {
      this.draw();
      return;
    }

    const base = {
      id: makeId("annotation"),
      stepId: this.options.stepId,
      color: this.options.getColor(),
      strokeWidth: this.options.getStrokeWidth(),
      createdAt: new Date().toISOString()
    };

    const annotation: Annotation =
      draft.kind === "circle" || draft.kind === "highlight"
        ? {
            ...base,
            kind: draft.kind,
            x: Math.min(draft.startX, draft.currentX),
            y: Math.min(draft.startY, draft.currentY),
            width: Math.abs(width),
            height: Math.abs(height)
          }
        : {
            ...base,
            kind: "arrow",
            x: draft.startX,
            y: draft.startY,
            x2: draft.currentX,
            y2: draft.currentY
          };

    this.options.store.addAnnotation(this.options.reportId, annotation);
    this.options.canvas.releasePointerCapture(event.pointerId);
  }

  private cancel(): void {
    this.draft = undefined;
    this.panStart = undefined;
    this.draw();
  }

  private toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.options.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.options.canvas.height
    };
  }

  private drawAnnotation(annotation: Annotation): void {
    this.context.save();
    this.context.strokeStyle = annotation.color;
    this.context.fillStyle = annotation.color;
    this.context.lineWidth = annotation.strokeWidth;
    this.context.lineCap = "round";
    this.context.lineJoin = "round";

    if (annotation.kind === "highlight") {
      this.context.globalAlpha = 0.28;
      this.drawFilledEllipse(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
      this.context.globalAlpha = 0.95;
      this.drawEllipse(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
    } else if (annotation.kind === "circle") {
      this.drawEllipse(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
    } else if (annotation.kind === "arrow") {
      this.drawArrow(annotation.x, annotation.y, annotation.x2 ?? annotation.x, annotation.y2 ?? annotation.y);
    } else {
      this.drawText(annotation);
    }

    this.context.restore();
  }

  private drawDraft(draft: Draft): void {
    this.context.save();
    this.context.strokeStyle = this.options.getColor();
    this.context.fillStyle = this.options.getColor();
    this.context.lineWidth = this.options.getStrokeWidth();
    this.context.setLineDash([10, 8]);

    if (draft.kind === "circle" || draft.kind === "highlight") {
      this.drawEllipse(
        Math.min(draft.startX, draft.currentX),
        Math.min(draft.startY, draft.currentY),
        Math.abs(draft.currentX - draft.startX),
        Math.abs(draft.currentY - draft.startY)
      );
    } else {
      this.drawArrow(draft.startX, draft.startY, draft.currentX, draft.currentY);
    }

    this.context.restore();
  }

  private drawEllipse(x: number, y: number, width: number, height: number): void {
    this.context.beginPath();
    this.context.ellipse(x + width / 2, y + height / 2, Math.max(width / 2, 1), Math.max(height / 2, 1), 0, 0, Math.PI * 2);
    this.context.stroke();
  }

  private drawFilledEllipse(x: number, y: number, width: number, height: number): void {
    this.context.beginPath();
    this.context.ellipse(x + width / 2, y + height / 2, Math.max(width / 2, 1), Math.max(height / 2, 1), 0, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawArrow(x1: number, y1: number, x2: number, y2: number): void {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = 18;
    this.context.beginPath();
    this.context.moveTo(x1, y1);
    this.context.lineTo(x2, y2);
    this.context.stroke();
    this.context.beginPath();
    this.context.moveTo(x2, y2);
    this.context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    this.context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    this.context.closePath();
    this.context.fill();
  }

  private drawText(annotation: Annotation): void {
    const text = annotation.text ?? "";
    const fontSize = Math.max(18, annotation.strokeWidth * 7);
    this.context.font = `700 ${fontSize}px system-ui, sans-serif`;
    this.context.lineWidth = Math.max(annotation.strokeWidth + 2, 5);
    this.context.strokeStyle = "rgba(255,255,255,0.88)";
    this.context.strokeText(text, annotation.x, annotation.y);
    this.context.fillText(text, annotation.x, annotation.y);
  }

  private drawCursor(point: CursorPoint): void {
    this.context.save();
    this.context.fillStyle = "rgba(255, 218, 77, 0.12)";
    this.context.beginPath();
    this.context.arc(point.x, point.y, 30, 0, Math.PI * 2);
    this.context.fill();
    this.context.strokeStyle = "rgba(20, 28, 31, 0.48)";
    this.context.lineWidth = 3;
    this.context.setLineDash([7, 7]);
    this.context.beginPath();
    this.context.arc(point.x, point.y, 24, 0, Math.PI * 2);
    this.context.stroke();
    this.context.setLineDash([]);
    this.context.strokeStyle = "rgba(20, 28, 31, 0.42)";
    this.context.lineWidth = 2;
    this.context.beginPath();
    this.context.moveTo(point.x - 38, point.y);
    this.context.lineTo(point.x - 28, point.y);
    this.context.moveTo(point.x + 28, point.y);
    this.context.lineTo(point.x + 38, point.y);
    this.context.moveTo(point.x, point.y - 38);
    this.context.lineTo(point.x, point.y - 28);
    this.context.moveTo(point.x, point.y + 28);
    this.context.lineTo(point.x, point.y + 38);
    this.context.stroke();
    this.context.fillStyle = "rgba(20, 28, 31, 0.52)";
    this.context.beginPath();
    this.context.arc(point.x, point.y, 3, 0, Math.PI * 2);
    this.context.fill();
    this.context.restore();
  }
}
