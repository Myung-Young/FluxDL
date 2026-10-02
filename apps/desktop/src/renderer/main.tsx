import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME, App } from "@grabber/core";

document.title = APP_NAME;

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("Missing #root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
