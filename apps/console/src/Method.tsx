import { Link } from "react-router";
import { Published, Sandbox, Screen } from "./Derivation.js";
import styles from "./Method.module.css";
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

export function Method() {
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
        {/*
          Visible, and it was not for one build.
          
          The reasoning for hiding it was that a headline above a lead paragraph
          is a second register saying what the paragraph says. That is true of a
          MARKETING headline and false of a title: the reference this page is
          built on carries one at full size, and a reader arriving from a nav
          item has had nothing else to tell them where they are. Landing on a
          paragraph that opens "Dusky never sees what a website looks like" with
          no title above it is exactly as disorienting as it sounds.
        */}
        <h1 className={styles.title}>Where the screen comes from</h1>

        {/*
          The shape the rest of the page adds up to, before it is walked.

          Everything below is sequential: a sentence, a figure, a sentence, a
          figure. That is a good way to explain each step and a bad way to learn
          that there are three of them, which is most of why this page could be
          read start to finish and still leave somebody asking what it was.

          Drawn in the idiom the site already has rather than in box-and-arrow.
          There are no boxes anywhere on this site; there are hairlines, and
          things that sit on them and break them. The nav capsule breaks the top
          rule. These three marks break this one.
        */}
        <ol className={styles.flow}>
          <li className={styles.step}>
            <span className={styles.mark} data-kind="list" aria-hidden="true" />
            <span className={styles.who}>A website</span>
            <span className={styles.what}>publishes what it can do</span>
          </li>
          <li className={styles.step}>
            <span className={styles.mark} data-kind="dusky" aria-hidden="true" />
            <span className={styles.who}>Dusky</span>
            <span className={styles.what}>compiles it into screens</span>
          </li>
          <li className={styles.step}>
            <span className={styles.mark} data-kind="lens" aria-hidden="true" />
            <span className={styles.who}>Your glasses</span>
            <span className={styles.what}>show one at a time</span>
          </li>
        </ol>

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
