import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "@dusky/tokens/tokens.css";
import "./console.css";
import "./motion.css";
import { Landing } from "./Landing.js";
import { Workspace } from "./Workspace.js";

/**
 * Two views on one origin.
 *
 * One origin rather than two deployments, because a partner site's exposedTo
 * grant names an exact origin: a second host for the front door would be a
 * second origin that no site has granted, and every tool list on it would be
 * empty for a reason nobody could see.
 *
 * `/demo` is a real path rather than a query parameter, which means the host
 * has to serve index.html for it. See the rewrite in vercel/console.json;
 * without it a shared link 404s.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/demo" element={<Workspace />} />
        {/* Anything else is a mistyped link, and the front door is the most
            useful place to land. */}
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
