import { useState } from "react";
import { Link } from "react-router";
import styles from "./Landing.module.css";
import { RequirementsButton, RequirementsPanel, useRequirements } from "./Requirements.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

const REPO = "https://github.com/twinkling-reality/dusky";
const DEMO_VIDEO_EMBED_URL = import.meta.env["VITE_DEMO_VIDEO_EMBED_URL"]?.trim() || null;

const STAGE_ALT =
  "Dusky running: on the left the glasses view, headed Verdant Market, confirm, reading Add to " +
  "cart, oat-1, this spends money, and offering Confirm on enter or Cancel on escape. On the " +
  "right three unrelated businesses live in the same browser tab: a shop, a restaurant, and a " +
  "communications desk.";

export function Landing() {
  const probe = useRequirements();
  const [reqOpen, setReqOpen] = useState(false);

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
          ) : (
            <img
              className={styles.shot}
              data-squircle=""
              src="/stage.png"
              alt={STAGE_ALT}
              width={2784}
              height={864}
            />
          )}
        </div>
      </main>
    </>
  );
}
