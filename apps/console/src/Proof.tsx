import { Link } from "react-router";
import { Published, Sandbox, Screen } from "./Derivation.js";
import styles from "./Proof.module.css";
import { CONTRAST } from "./presets.js";
import { SiteHeader } from "./SiteHeader.js";
import header from "./SiteHeader.module.css";

/**
 * A read, with the demonstrations as its figures.
 *
 * Four earlier versions of this page arranged the demonstrations: a grid, a
 * matrix with a labelled gutter, three columns, two columns. Every one of them
 * needed labels to explain the arrangement, and those labels were the thing
 * nobody could read. Column heads, gutter labels, captions and a display
 * headline meant four typographic registers stacked above the first
 * demonstration, none of them a sentence, and somebody arriving cold had
 * nothing to hold on to.
 *
 * So there is no arrangement. There is a column of prose with figures dropped
 * between the paragraphs, in the manner of Bartosz Ciechanowski's articles, and
 * every figure is introduced by the sentence directly above it. The sentence
 * ends in a colon and the figure is the rest of it. Nothing is captioned,
 * because nothing needs to be.
 *
 * The cost is honest and worth stating: this page now rests entirely on its
 * prose. There is nowhere for bad writing to hide in a layout that has no
 * labels left.
 */

const REPO = "https://github.com/twinkling-reality/dusky";

export function Proof() {
  return (
    <>
      <SiteHeader>
        <Link className={header.link} to="/demo?start=1">
          Open Dusky
        </Link>
        <a className={header.link} href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </SiteHeader>

      <main className={styles.page}>
        {/* The document needs a name. The page does not print it: the first
            paragraph is the lead, and a display headline above a lead was one
            of the four registers this page kept accumulating. */}
        <h1 className={styles.srOnly}>Where the screen comes from</h1>

        <article className={styles.read}>
          <p>
            Dusky never sees what a website looks like. It only sees what the site says it can do,
            published in a format meant for machines. Verdant Market publishes four of these. This
            is one:
          </p>

          {/* The whole declaration, because the sentence above promised one and
              the paragraph below describes its three parts. The figures further
              down show a single property, because those sentences are about a
              single property. */}
          <figure className={styles.figure}>
            <Published code={CONTRAST.before.tool} />
          </figure>

          <p>
            A name, a sentence, and a description of what it needs to be told. There is nothing in
            it about layout and nothing about glasses. Dusky turns it into this:
          </p>

          <figure className={styles.figure}>
            <Screen side={CONTRAST.before} />
          </figure>

          <p>
            The question is the parameter&rsquo;s own description. The text box is there because{" "}
            <code>product_id</code> is declared as a plain string, and a string can be anything, so
            there is nothing to offer and the wearer has to type. Declare three permitted values
            instead and the same code draws this:
          </p>

          <figure className={styles.figure}>
            <Published code={CONTRAST.after.code} />
            <Screen side={CONTRAST.after} />
          </figure>

          <p>
            One line changed. No part of Dusky was touched between those two screens, and no part of
            it knows what a product is.
          </p>

          <p>
            The same holds for sites that share no vocabulary with a shop. A restaurant declares
            party sizes and whether you want to sit outside. An airline declares cabins. Change any
            of them, or type your own, and watch it compile:
          </p>
        </article>

        <figure className={styles.wide}>
          <Sandbox />
        </figure>
      </main>
    </>
  );
}
