import type { AnnotationSnapshot, AnnotationTool } from "../annotations/model";
import { AnnotationLayer } from "../annotations/canvas";
import { AnnotationStore } from "../annotations/store";
import { createReportsZip } from "../export/zip";
import { renderMarkdown } from "../export/markdown";
import { downloadBlob, safeFileName } from "../parser/file-utils";
import { parseMhtmlFile } from "../parser/mhtml";
import type { PsrReport, PsrStep, ReportAsset } from "../types/report";

interface PanState {
  x: number;
  y: number;
}

export class PsrFormatterApp {
  private reports: PsrReport[] = [];
  private activeReportId?: string;
  private readonly store = new AnnotationStore();
  private readonly layers: AnnotationLayer[] = [];
  private tool: AnnotationTool = "pan";
  private color = "#e24141";
  private strokeWidth = 4;
  private searchQuery = "";
  private zoom = 1;
  private compare = false;
  private showClickMarks = true;
  private presentation = false;
  private presentationIndex = 0;
  private status = "";
  private readonly pans = new Map<string, PanState>();
  private imageObserver?: IntersectionObserver;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    this.root.innerHTML = this.renderShell();
    this.bindEvents();
    this.applyTheme(localStorage.getItem("psr-theme") ?? "light");
    this.render();
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("change", (event) => this.onChange(event));
    this.root.addEventListener("input", (event) => this.onInput(event));
    this.root.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.root.classList.add("is-dragging");
    });
    this.root.addEventListener("dragleave", () => this.root.classList.remove("is-dragging"));
    this.root.addEventListener("drop", (event) => {
      event.preventDefault();
      this.root.classList.remove("is-dragging");
      void this.handleFiles(event.dataTransfer?.files);
    });
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.store.subscribe(() => this.syncCaptions());
  }

  private renderShell(): string {
    return `<div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">PSR</span>
          <strong>Formatter</strong>
        </div>
        <label class="file-button">
          <input class="sr-only" type="file" data-input="mhtml" accept=".mht,.mhtml,.mht.stub,message/rfc822" multiple>
          Open
        </label>
        <select class="report-select" data-input="report" aria-label="Report"></select>
        <input class="search-input" data-input="search" type="search" placeholder="Search steps" aria-label="Search steps">
        <div class="toolbar-group">
          <button type="button" data-action="zip">ZIP</button>
          <button type="button" data-action="json-export">JSON</button>
          <label class="file-button secondary">
            <input class="sr-only" type="file" data-input="json-import" accept="application/json,.json">
            Import
          </label>
          <button type="button" data-action="markdown">MD</button>
          <button type="button" data-action="print">Print</button>
          <button type="button" data-action="theme">Theme</button>
          <button type="button" data-action="presentation">Present</button>
        </div>
      </header>
      <main class="workspace">
        <aside class="thumb-panel">
          <div class="panel-title">Steps</div>
          <div class="thumb-scroll"></div>
        </aside>
        <section class="report-view" aria-live="polite"></section>
        <aside class="tool-panel">
          <div class="panel-title">Tools</div>
          <div class="segmented" data-tool-group>
            <button type="button" data-tool="pan" aria-pressed="true">Pan</button>
            <button type="button" data-tool="circle">Circle</button>
            <button type="button" data-tool="highlight">Highlight</button>
            <button type="button" data-tool="arrow">Arrow</button>
            <button type="button" data-tool="text">Text</button>
          </div>
          <label class="field-label">Color <input type="color" data-input="color" value="${this.color}"></label>
          <label class="field-label">Stroke <input type="range" data-input="stroke" min="2" max="12" value="${this.strokeWidth}"></label>
          <div class="zoom-row">
            <button type="button" data-action="zoom-out">-</button>
            <output data-output="zoom">100%</output>
            <button type="button" data-action="zoom-in">+</button>
          </div>
          <button type="button" data-action="zoom-reset">Reset View</button>
          <button type="button" data-action="undo">Undo</button>
          <button type="button" data-action="redo">Redo</button>
          <button type="button" data-action="clickmarks">Click marks</button>
          <button type="button" data-action="compare">Compare</button>
          <div class="presentation-controls">
            <button type="button" data-action="prev-step">Prev</button>
            <button type="button" data-action="next-step">Next</button>
          </div>
          <p class="status" data-output="status"></p>
        </aside>
      </main>
    </div>`;
  }

  private render(): void {
    this.renderReportSelect();
    this.renderSteps();
    this.renderThumbnails();
    this.updateToolButtons();
    this.updateStatus();
    this.updateChromeState();
  }

  private renderReportSelect(): void {
    const select = this.root.querySelector<HTMLSelectElement>('[data-input="report"]');

    if (!select) {
      return;
    }

    select.innerHTML = this.reports
      .map((report) => `<option value="${report.id}" ${report.id === this.activeReportId ? "selected" : ""}>${escapeHtml(report.title)}</option>`)
      .join("");
    select.disabled = this.reports.length <= 1;
  }

  private renderSteps(): void {
    this.destroyLayers();
    this.imageObserver?.disconnect();
    const view = this.root.querySelector<HTMLElement>(".report-view");
    const report = this.activeReport();

    if (!view) {
      return;
    }

    if (!report) {
      view.innerHTML = `<div class="empty-state">
        <div>
          <h1>Drop PSR .mht or .mhtml files</h1>
          <p>Everything runs in this browser tab.</p>
        </div>
      </div>`;
      return;
    }

    const visibleSteps = this.visibleSteps(report);
    view.innerHTML = `<div class="report-header">
      <div>
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.fileName)} · ${report.steps.length} steps · ${report.assets.filter((asset) => asset.kind === "image").length} images</p>
      </div>
    </div>
    <div class="steps">${visibleSteps.map((step) => this.renderStep(report, step)).join("")}</div>`;
    this.setupLazyImages();
    this.setupAnnotationLayers(report);
    this.autoSizeCaptions();
  }

  private renderStep(report: PsrReport, step: PsrStep): string {
    const screenshot = report.assets.find((asset) => asset.id === step.screenshotAssetId);
    const caption = this.store.getCaption(report.id, step.id, step.caption);
    const expanded = this.presentation || step.expanded;
    const description = this.highlight(step.description);
    const media = screenshot ? this.renderMedia(step, screenshot, caption) : `<div class="no-shot">No screenshot extracted for this step.</div>`;

    return `<article class="step ${expanded ? "is-open" : ""}" data-step-id="${step.id}">
      <header class="step-header">
        <button type="button" class="icon-button" data-action="collapse" data-step-id="${step.id}" aria-expanded="${expanded}">${expanded ? "-" : "+"}</button>
        <div class="step-title">
          <h2>Step ${step.index}</h2>
          <textarea class="caption-input" data-caption="${step.id}" rows="2" aria-label="Step ${step.index} caption">${escapeHtml(caption)}</textarea>
        </div>
        <button type="button" data-action="clear-step" data-step-id="${step.id}">Clear</button>
      </header>
      <div class="step-body">
        ${step.timestamp ? `<p class="step-meta">${escapeHtml(step.timestamp)}</p>` : ""}
        <p class="step-description">${description}</p>
        ${media}
      </div>
    </article>`;
  }

  private renderMedia(step: PsrStep, screenshot: ReportAsset, caption: string): string {
    const pan = this.pans.get(step.id) ?? { x: 0, y: 0 };
    const transform = `translate(${pan.x}px, ${pan.y}px) scale(${this.zoom})`;
    const url = screenshot.objectUrl ?? "";

    return `<div class="media-grid ${this.compare ? "is-compare" : ""}">
      <div class="compare-pane">
        <div class="pane-label">Original</div>
        <img loading="lazy" data-src="${escapeAttribute(url)}" alt="${escapeAttribute(caption)}">
      </div>
      <div class="image-viewport">
        <div class="pane-label">Annotated</div>
        <div class="image-frame" data-frame="${step.id}" style="transform:${escapeAttribute(transform)}">
          <img class="shot-image" loading="lazy" data-src="${escapeAttribute(url)}" alt="${escapeAttribute(caption)}">
          <canvas class="annotation-canvas" data-canvas="${step.id}"></canvas>
        </div>
      </div>
    </div>`;
  }

  private renderThumbnails(): void {
    const scroll = this.root.querySelector<HTMLElement>(".thumb-scroll");
    const report = this.activeReport();

    if (!scroll) {
      return;
    }

    if (!report) {
      scroll.innerHTML = "";
      return;
    }

    const steps = this.visibleSteps(report, false);
    const rowHeight = 116;
    const viewportHeight = scroll.clientHeight || 640;
    const start = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 4);
    const end = Math.min(steps.length, Math.ceil((scroll.scrollTop + viewportHeight) / rowHeight) + 4);
    const items = steps.slice(start, end).map((step, offset) => this.renderThumb(report, step, (start + offset) * rowHeight)).join("");
    scroll.innerHTML = `<div class="thumb-canvas" style="height:${steps.length * rowHeight}px">${items}</div>`;
    scroll.onscroll = () => this.renderThumbnails();
  }

  private renderThumb(report: PsrReport, step: PsrStep, top: number): string {
    const screenshot = report.assets.find((asset) => asset.id === step.screenshotAssetId);
    const caption = this.store.getCaption(report.id, step.id, step.caption);
    const image = screenshot ? `<img loading="lazy" src="${escapeAttribute(screenshot.objectUrl ?? "")}" alt="">` : `<span class="thumb-missing">--</span>`;
    const active = this.presentation && this.visibleSteps(report)[0]?.id === step.id ? "is-active" : "";

    return `<button type="button" class="thumb ${active}" data-action="thumb" data-step-id="${step.id}" style="top:${top}px">
      ${image}
      <span>${step.index}. ${escapeHtml(caption)}</span>
    </button>`;
  }

  private setupLazyImages(): void {
    const images = Array.from(this.root.querySelectorAll<HTMLImageElement>("img[data-src]"));

    if (!("IntersectionObserver" in window)) {
      for (const image of images) {
        image.src = image.dataset.src ?? "";
      }
      return;
    }

    this.imageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        const image = entry.target as HTMLImageElement;
        image.src = image.dataset.src ?? "";
        this.imageObserver?.unobserve(image);
      }
    }, { rootMargin: "450px 0px" });

    for (const image of images) {
      this.imageObserver.observe(image);
    }
  }

  private setupAnnotationLayers(report: PsrReport): void {
    for (const step of report.steps) {
      const canvas = this.root.querySelector<HTMLCanvasElement>(`canvas[data-canvas="${step.id}"]`);
      const frame = this.root.querySelector<HTMLElement>(`[data-frame="${step.id}"]`);
      const image = frame?.querySelector<HTMLImageElement>(".shot-image");

      if (!canvas || !frame || !image) {
        continue;
      }

      this.layers.push(
        new AnnotationLayer({
          reportId: report.id,
          stepId: step.id,
          canvas,
          image,
          frame,
          cursor: this.showClickMarks ? step.cursor : undefined,
          store: this.store,
          getTool: () => this.tool,
          getColor: () => this.color,
          getStrokeWidth: () => this.strokeWidth,
          onPan: (deltaX, deltaY) => this.panStep(step.id, frame, deltaX, deltaY)
        })
      );
    }
  }

  private async handleFiles(fileList: FileList | undefined | null): Promise<void> {
    const files = Array.from(fileList ?? []).filter((file) => /\.(mht|mhtml)(?:\.stub)?$/i.test(file.name));

    if (!files.length) {
      this.status = "Choose .mht or .mhtml files.";
      this.updateStatus();
      return;
    }

    this.status = `Parsing ${files.length} file${files.length === 1 ? "" : "s"}...`;
    this.updateStatus();

    const results = await Promise.allSettled(files.map((file) => parseMhtmlFile(file)));
    const parsed: PsrReport[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        parsed.push(result.value);
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }

    for (const report of parsed) {
      this.store.ensureReport(report);
    }

    this.reports.push(...parsed);
    this.activeReportId = this.activeReportId ?? parsed[0]?.id;
    this.status = errors.length ? `${parsed.length} parsed, ${errors.length} failed.` : `${parsed.length} report${parsed.length === 1 ? "" : "s"} ready.`;
    this.render();
  }

  private onClick(event: Event): void {
    const target = event.target as HTMLElement;
    const toolButton = target.closest<HTMLButtonElement>("[data-tool]");

    if (toolButton) {
      this.tool = toolButton.dataset.tool as AnnotationTool;
      this.updateToolButtons();
      return;
    }

    const button = target.closest<HTMLElement>("[data-action]");

    if (!button) {
      return;
    }

    const action = button.dataset.action ?? "";
    void this.runAction(action, button);
  }

  private async runAction(action: string, button: HTMLElement): Promise<void> {
    const report = this.activeReport();

    if (action === "zip") {
      await this.exportZip();
    } else if (action === "json-export") {
      this.exportJson();
    } else if (action === "markdown") {
      this.exportMarkdown();
    } else if (action === "print") {
      window.print();
    } else if (action === "theme") {
      this.toggleTheme();
    } else if (action === "presentation") {
      this.presentation = !this.presentation;
      this.presentationIndex = 0;
      this.render();
    } else if (action === "zoom-in") {
      this.setZoom(this.zoom + 0.15);
    } else if (action === "zoom-out") {
      this.setZoom(this.zoom - 0.15);
    } else if (action === "zoom-reset") {
      this.resetView();
    } else if (action === "undo") {
      this.store.undo();
    } else if (action === "redo") {
      this.store.redo();
    } else if (action === "clickmarks") {
      this.showClickMarks = !this.showClickMarks;
      this.render();
    } else if (action === "compare") {
      this.compare = !this.compare;
      this.render();
    } else if (action === "prev-step") {
      this.movePresentation(-1);
    } else if (action === "next-step") {
      this.movePresentation(1);
    } else if (action === "collapse" && report) {
      this.toggleStep(report, button.dataset.stepId ?? "");
    } else if (action === "clear-step" && report) {
      this.store.clearStep(report.id, button.dataset.stepId ?? "");
    } else if (action === "thumb") {
      this.focusStep(button.dataset.stepId ?? "");
    }
  }

  private onChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

    if (target.matches('[data-input="mhtml"]')) {
      void this.handleFiles((target as HTMLInputElement).files);
      target.value = "";
    } else if (target.matches('[data-input="json-import"]')) {
      void this.importJson((target as HTMLInputElement).files?.[0]);
      target.value = "";
    } else if (target.matches('[data-input="report"]')) {
      this.activeReportId = target.value;
      this.presentationIndex = 0;
      this.render();
    } else if (target.matches("[data-caption]")) {
      const report = this.activeReport();

      if (report) {
        this.store.setCaption(report.id, target.dataset.caption ?? "", target.value);
        this.renderThumbnails();
      }
    }
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;

    if (target.matches('[data-input="search"]')) {
      this.searchQuery = target.value;
      this.presentationIndex = 0;
      this.renderSteps();
      this.renderThumbnails();
    } else if (target.matches('[data-input="color"]')) {
      this.color = target.value;
    } else if (target.matches('[data-input="stroke"]')) {
      this.strokeWidth = Number(target.value);
    } else if (target.matches("[data-caption]") && target instanceof HTMLTextAreaElement) {
      this.autoSizeCaption(target);
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.store.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.store.redo();
    } else if (this.presentation && event.key === "ArrowRight") {
      this.movePresentation(1);
    } else if (this.presentation && event.key === "ArrowLeft") {
      this.movePresentation(-1);
    } else if (event.key === "Escape" && this.presentation) {
      this.presentation = false;
      this.render();
    }
  }

  private async exportZip(): Promise<void> {
    if (!this.reports.length) {
      this.status = "Open a PSR file first.";
      this.updateStatus();
      return;
    }

    this.status = "Packaging ZIP...";
    this.updateStatus();
    const blob = await createReportsZip(this.reports, this.store);
    downloadBlob(blob, "psr-reports.zip");
    this.status = "ZIP ready.";
    this.updateStatus();
  }

  private exportJson(): void {
    if (!this.reports.length) {
      return;
    }

    const blob = new Blob([JSON.stringify(this.store.toSnapshot(this.reports), null, 2)], { type: "application/json" });
    downloadBlob(blob, "psr-annotations.json");
  }

  private exportMarkdown(): void {
    const report = this.activeReport();

    if (!report) {
      return;
    }

    const blob = new Blob([renderMarkdown(report, this.store)], { type: "text/markdown" });
    downloadBlob(blob, `${safeFileName(report.title)}.md`);
  }

  private async importJson(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    const snapshot = JSON.parse(await file.text()) as AnnotationSnapshot;
    this.store.importSnapshot(snapshot, this.reports);
    this.status = "Annotations imported.";
    this.render();
  }

  private visibleSteps(report: PsrReport, respectPresentation = true): PsrStep[] {
    const query = this.searchQuery.trim().toLowerCase();
    const searched = query
      ? report.steps.filter((step) => {
          const caption = this.store.getCaption(report.id, step.id, step.caption);
          return `${caption} ${step.action} ${step.description}`.toLowerCase().includes(query);
        })
      : report.steps;

    if (this.presentation && respectPresentation) {
      return searched.slice(this.presentationIndex, this.presentationIndex + 1);
    }

    return searched;
  }

  private activeReport(): PsrReport | undefined {
    return this.reports.find((report) => report.id === this.activeReportId) ?? this.reports[0];
  }

  private toggleStep(report: PsrReport, stepId: string): void {
    const step = report.steps.find((candidate) => candidate.id === stepId);

    if (step) {
      step.expanded = !step.expanded;
      this.renderSteps();
    }
  }

  private focusStep(stepId: string): void {
    const report = this.activeReport();

    if (!report) {
      return;
    }

    if (this.presentation) {
      const index = this.visibleSteps(report, false).findIndex((step) => step.id === stepId);
      this.presentationIndex = Math.max(0, index);
      this.render();
      return;
    }

    this.root.querySelector<HTMLElement>(`[data-step-id="${stepId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private movePresentation(delta: number): void {
    const report = this.activeReport();

    if (!report) {
      return;
    }

    const steps = this.visibleSteps(report, false);
    this.presentationIndex = Math.min(Math.max(this.presentationIndex + delta, 0), Math.max(steps.length - 1, 0));
    this.render();
  }

  private setZoom(value: number): void {
    this.zoom = Math.min(3, Math.max(0.35, value));
    this.applyTransforms();
    this.updateZoomOutput();
  }

  private resetView(): void {
    this.zoom = 1;
    this.pans.clear();
    this.applyTransforms();
    this.updateZoomOutput();
  }

  private panStep(stepId: string, frame: HTMLElement, deltaX: number, deltaY: number): void {
    const current = this.pans.get(stepId) ?? { x: 0, y: 0 };
    const next = { x: current.x + deltaX, y: current.y + deltaY };
    this.pans.set(stepId, next);
    frame.style.transform = `translate(${next.x}px, ${next.y}px) scale(${this.zoom})`;
  }

  private applyTransforms(): void {
    for (const frame of Array.from(this.root.querySelectorAll<HTMLElement>("[data-frame]"))) {
      const stepId = frame.dataset.frame ?? "";
      const pan = this.pans.get(stepId) ?? { x: 0, y: 0 };
      frame.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${this.zoom})`;
    }
  }

  private syncCaptions(): void {
    const report = this.activeReport();

    if (!report) {
      return;
    }

    for (const input of Array.from(this.root.querySelectorAll<HTMLTextAreaElement>("[data-caption]"))) {
      const step = report.steps.find((candidate) => candidate.id === input.dataset.caption);

      if (step) {
        input.value = this.store.getCaption(report.id, step.id, step.caption);
        this.autoSizeCaption(input);
      }
    }
  }

  private autoSizeCaptions(): void {
    for (const input of Array.from(this.root.querySelectorAll<HTMLTextAreaElement>(".caption-input"))) {
      this.autoSizeCaption(input);
    }
  }

  private autoSizeCaption(input: HTMLTextAreaElement): void {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }

  private updateToolButtons(): void {
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-tool]"))) {
      const active = button.dataset.tool === this.tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    const clickMarks = this.root.querySelector<HTMLButtonElement>('[data-action="clickmarks"]');
    clickMarks?.classList.toggle("is-active", this.showClickMarks);
    clickMarks?.setAttribute("aria-pressed", String(this.showClickMarks));
  }

  private updateStatus(): void {
    const status = this.root.querySelector<HTMLElement>('[data-output="status"]');

    if (status) {
      status.textContent = this.status;
    }
  }

  private updateChromeState(): void {
    const shell = this.root.querySelector<HTMLElement>(".app-shell");
    shell?.classList.toggle("has-report", this.reports.length > 0);
    shell?.classList.toggle("is-presentation", this.presentation);
    shell?.classList.toggle("is-compare", this.compare);
    this.updateZoomOutput();
  }

  private updateZoomOutput(): void {
    const output = this.root.querySelector<HTMLOutputElement>('[data-output="zoom"]');

    if (output) {
      output.value = `${Math.round(this.zoom * 100)}%`;
      output.textContent = output.value;
    }
  }

  private toggleTheme(): void {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    this.applyTheme(current === "dark" ? "light" : "dark");
  }

  private applyTheme(theme: string): void {
    const normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem("psr-theme", normalized);
  }

  private highlight(value: string): string {
    const escaped = escapeHtml(value || "");
    const query = this.searchQuery.trim();

    if (!query) {
      return escaped;
    }

    return escaped.replace(new RegExp(`(${escapeRegExp(query)})`, "gi"), "<mark>$1</mark>");
  }

  private destroyLayers(): void {
    while (this.layers.length) {
      this.layers.pop()?.destroy();
    }
  }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
