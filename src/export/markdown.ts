import type { AnnotationStore } from "../annotations/store";
import type { PsrReport } from "../types/report";

export function renderMarkdown(report: PsrReport, store: AnnotationStore, assetPath = "assets"): string {
  const lines = [`# ${report.title}`, "", `Source: ${report.fileName}`, ""];

  for (const step of report.steps) {
    const caption = store.getCaption(report.id, step.id, step.caption);
    const screenshot = report.assets.find((asset) => asset.id === step.screenshotAssetId);
    lines.push(`## Step ${step.index}: ${caption}`, "");

    if (step.timestamp) {
      lines.push(`Time: ${step.timestamp}`, "");
    }

    if (step.description && step.description !== caption) {
      lines.push(step.description, "");
    }

    if (screenshot) {
      lines.push(`![${caption}](${assetPath}/${screenshot.name})`, "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
