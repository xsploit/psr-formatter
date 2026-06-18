import type { PsrReport } from "../types/report";
import type { Annotation, AnnotationSnapshot, AnnotationState } from "./model";

type Listener = () => void;

export class AnnotationStore {
  private states = new Map<string, AnnotationState>();
  private listeners = new Set<Listener>();
  private past: string[] = [];
  private future: string[] = [];

  ensureReport(report: PsrReport): void {
    if (this.states.has(report.id)) {
      return;
    }

    this.states.set(report.id, {
      annotations: [],
      captions: Object.fromEntries(report.steps.map((step) => [step.id, step.caption]))
    });
    this.pushHistory();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(reportId: string): AnnotationState {
    return this.states.get(reportId) ?? { annotations: [], captions: {} };
  }

  getAnnotations(reportId: string, stepId?: string): Annotation[] {
    const annotations = this.getState(reportId).annotations;
    return stepId ? annotations.filter((annotation) => annotation.stepId === stepId) : annotations;
  }

  getCaption(reportId: string, stepId: string, fallback: string): string {
    return this.getState(reportId).captions[stepId] ?? fallback;
  }

  setCaption(reportId: string, stepId: string, value: string): void {
    this.mutate(() => {
      const state = this.getMutableState(reportId);
      state.captions[stepId] = value;
    });
  }

  addAnnotation(reportId: string, annotation: Annotation): void {
    this.mutate(() => {
      this.getMutableState(reportId).annotations.push(annotation);
    });
  }

  clearStep(reportId: string, stepId: string): void {
    this.mutate(() => {
      const state = this.getMutableState(reportId);
      state.annotations = state.annotations.filter((annotation) => annotation.stepId !== stepId);
    });
  }

  undo(): boolean {
    if (this.past.length <= 1) {
      return false;
    }

    const current = this.past.pop();

    if (current) {
      this.future.push(current);
    }

    this.restore(this.past[this.past.length - 1]);
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();

    if (!next) {
      return false;
    }

    this.past.push(next);
    this.restore(next);
    this.emit();
    return true;
  }

  toSnapshot(reports: PsrReport[]): AnnotationSnapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      reports: reports.map((report) => {
        const state = this.getState(report.id);
        return {
          reportId: report.id,
          fileName: report.fileName,
          annotations: state.annotations,
          captions: state.captions
        };
      })
    };
  }

  importSnapshot(snapshot: AnnotationSnapshot, reports: PsrReport[]): void {
    this.mutate(() => {
      for (const imported of snapshot.reports) {
        const report =
          reports.find((candidate) => candidate.id === imported.reportId) ??
          reports.find((candidate) => candidate.fileName === imported.fileName);

        if (!report) {
          continue;
        }

        this.states.set(report.id, {
          annotations: imported.annotations.filter((annotation) => report.steps.some((step) => step.id === annotation.stepId)),
          captions: { ...imported.captions }
        });
      }
    });
  }

  private mutate(update: () => void): void {
    update();
    this.pushHistory();
    this.future = [];
    this.emit();
  }

  private getMutableState(reportId: string): AnnotationState {
    const existing = this.states.get(reportId);

    if (existing) {
      return existing;
    }

    const created: AnnotationState = { annotations: [], captions: {} };
    this.states.set(reportId, created);
    return created;
  }

  private pushHistory(): void {
    const serialized = this.serialize();

    if (this.past[this.past.length - 1] !== serialized) {
      this.past.push(serialized);
    }

    if (this.past.length > 80) {
      this.past.shift();
    }
  }

  private serialize(): string {
    return JSON.stringify(Array.from(this.states.entries()));
  }

  private restore(serialized: string): void {
    const parsed = JSON.parse(serialized) as Array<[string, AnnotationState]>;
    this.states = new Map(parsed);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
