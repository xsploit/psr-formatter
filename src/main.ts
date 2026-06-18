import "../assets/css/styles.css";
import { PsrFormatterApp } from "./viewer/viewer";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const app = new PsrFormatterApp(root);
app.mount();
