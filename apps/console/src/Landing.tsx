import { Link } from "react-router";
import { Checklist } from "./Checklist.js";
import { Derivation } from "./Derivation.js";
import styles from "./Landing.module.css";

/**
 * The front door.
 *
 * The order here is deliberate and it is not the obvious one. The first thing
 * on the page is the argument, not the demo, because the derivation runs in
 * any browser and the demo does not: WebMCP is required to consume another
 * site's tools, and somebody arriving in the wrong browser would otherwise
 * hit a wall before seeing anything at all. Evidence is also better read
 * after the claim it is evidence for.
 *
 * The requirement is stated beside the pitch rather than discovered when
 * something breaks.
 */

const REPO = "https://github.com/glendonchin/dusky";
const FLAG = "chrome://flags/#enable-webmcp-testing";

export function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.wordmark}>Dusky</span>
        <h1 className={styles.claim}>A browser for a web made of tools instead of pages.</h1>
        <p className={styles.lede}>
          Dusky turns a website&rsquo;s declared WebMCP tools into a glanceable, gesture-driven
          interface for Meta Ray-Ban Display: 600 by 600, six keys, no cursor. It reads the actions
          a site chose to publish and asks you one question at a time. There is no per-site
          integration anywhere in it.
        </p>

        <div className={styles.actions}>
          <Link className={styles.primary} to="/demo">
            Try it now, no glasses
          </Link>
          <a className={styles.secondary} href={REPO} target="_blank" rel="noreferrer">
            Read the source
          </a>
        </div>

        <p className={styles.requires}>
          <strong>Needs a WebMCP browser to run the live demo:</strong> Chrome 149 or later with{" "}
          <code>{FLAG}</code>, or the ChatGPT desktop app&rsquo;s built-in browser. Consuming
          another site&rsquo;s tools is a permission only a browser can grant. Everything below this
          line works in any browser.
        </p>

        <Checklist />
      </header>

      {/* The argument, first, because it needs nothing from your browser. */}
      <Derivation />

      <section className={styles.prose}>
        <h2 className={styles.h2}>Why the tab stays open</h2>
        <p>
          A tool does not run on Dusky&rsquo;s servers. It runs in your browser, inside the partner
          site&rsquo;s own document, in your own logged-in session, mediated by the browser. Dusky
          moves intent between your glasses and that tab and never moves a credential, which is why
          it never needs one.
        </p>
        <p>
          The cost of that is the tab: close it and the session ends, because the capability lived
          there and nowhere else. On real glasses this is a browser on your phone or laptop that you
          are not looking at. It is the security model rather than a limitation, and it is the
          reason the protocol log on the demo page can show you every call: they all happen where
          you can see them.
        </p>

        <h2 className={styles.h2}>What decides, and what only suggests</h2>
        <p>
          Whether something stops for your approval is decided by code with no model, no network and
          no DOM in it. A site&rsquo;s own <code>readOnlyHint</code> can lower ceremony but never
          raise it, because the site making the claim may be the one you need protecting from. Try
          the last preset above: a tool named <code>delete_account</code>, titled &ldquo;Free
          storage checkup&rdquo;, declaring itself read-only. It is still gated, and the reason says
          why.
        </p>
        <p>
          Success is read from what a tool returned, never from the fact that it returned. A site
          answering{" "}
          <code>
            {"{"}"ok": false{"}"}
          </code>{" "}
          has given you a result, and that result is a failure.
        </p>

        <h2 className={styles.h2}>What Dusky does not claim</h2>
        <ul className={styles.claims}>
          <li>
            <strong>It does not work with arbitrary WebMCP sites.</strong> A site has to name
            Dusky&rsquo;s origin in <code>exposedTo</code> first. That is a deliberate security
            property of the specification, the browser enforces it, and it is why the two sites in
            the demo are first-party.
          </li>
          <li>
            <strong>It does not integrate with Meta AI</strong> or extend its voice commands.
          </li>
          <li>
            <strong>There is no microphone or camera on the Display.</strong> Free text arrives
            through the on-glasses composer, which the wearer opens.
          </li>
          <li>
            <strong>It cannot drive every tool.</strong> A parameter that is a nested object or an
            array cannot be collected in one glance on six keys, so those tools are left off the
            menu rather than offered as a control that dead-ends.
          </li>
        </ul>
      </section>

      <footer className={styles.foot}>
        <a href={REPO} target="_blank" rel="noreferrer">
          Source and full notes
        </a>
        <Link to="/demo">Open the demo</Link>
      </footer>
    </div>
  );
}
