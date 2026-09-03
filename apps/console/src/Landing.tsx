import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import styles from "./Landing.module.css";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

const REPO = "https://github.com/twinkling-reality/dusky";
const DEMO_VIDEO_EMBED_URL = import.meta.env["VITE_DEMO_VIDEO_EMBED_URL"]?.trim() || null;

const STAGE_ALT =
  "Dusky on Meta Ray-Ban Display beside the console: glasses choosing an Amber & Oak " +
  "reservation step while the browser topology shows the paired Display, runtime, and " +
  "provider actions succeeding.";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

export function Landing() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  return (
    <>
      <SiteHeader>
        <div className={styles.reqAnchor}>
          <RequirementsButton
            probe={probe}
            open={reqOpen}
            onToggle={() => setReqOpen((v) => !v)}
            className={styles.reqBtn}
          />
          {reqOpen && <RequirementsPanel probe={probe} onClose={() => setReqOpen(false)} />}
        </div>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page} data-motion-route="landing">
        <section className={styles.hero}>
          <h1 className={styles.claim} data-motion-item="" data-motion-order="1">
            Turn web actions into augmented reality.
          </h1>
          <p className={styles.lede} data-motion-item="" data-motion-order="2">
            Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for
            AR displays.
          </p>

          {probe.verdict === "bad" && (
            <p className={styles.readiness} role="alert" data-motion-item="" data-motion-order="3">
              <strong>Dusky cannot run here yet: {probe.headline}.</strong>
              <button type="button" onClick={() => setReqOpen(true)} aria-controls="requirements">
                See the fix
              </button>
            </p>
          )}

          <div className={styles.actions} data-motion-item="" data-motion-order="4">
            <Link className={styles.primary} to="/demo?start=1" viewTransition>
              Open Dusky
              <span className={styles.arrow} aria-hidden="true">
                &rarr;
              </span>
            </Link>
            <Link className={styles.secondary} to="/demo" viewTransition>
              I have glasses
            </Link>
          </div>
        </section>

        <div className={styles.stage} data-motion-item="" data-motion-order="5">
          {DEMO_VIDEO_EMBED_URL ? (
            <iframe
              className={`${styles.shot} ${styles.video}`}
              data-squircle=""
              data-demo-video=""
              src={DEMO_VIDEO_EMBED_URL}
              title="Dusky product demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : reduceMotion ? (
            <img
              className={styles.shot}
              data-squircle=""
              src="/stage.png"
              alt={STAGE_ALT}
              width={1496}
              height={650}
            />
          ) : (
            <video
              className={styles.shot}
              data-squircle=""
              data-stage-loop=""
              src="/stage.mp4"
              poster="/stage.png"
              autoPlay
              muted
              loop
              playsInline
              aria-label={STAGE_ALT}
              width={1496}
              height={650}
            />
          )}
        </div>
      </main>
    </>
  );
}
