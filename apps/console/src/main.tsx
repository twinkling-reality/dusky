import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@dusky/tokens/tokens.css";
import "./console.css";
import { Landing } from "./Landing.js";
import { Proof } from "./Proof.js";
import { Workspace } from "./Workspace.js";

/**
 * Three views on one origin.
 *
 * One origin rather than two deployments, because a partner site's exposedTo
 * grant names an exact origin: a second host for the front door would be a
 * second origin that no site has granted, and every tool list on it would be
 * empty for a reason nobody could see.
 *
 * `/demo` and `/proof` are real paths rather than query parameters, which
 * means the host has to serve index.html for them. See the rewrite in
 * vercel/console.json; without it a shared link to either one 404s.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/demo" element={<Workspace />} />
        <Route path="/proof" element={<Proof />} />
        {/* Anything else is a mistyped link, and the front door is the most
            useful place to land. */}
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
