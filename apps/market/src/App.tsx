import { registerTools } from "@dusky/webmcp";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./App.module.css";
import { CATALOG, money, type Product } from "./catalog.js";

/**
 * Verdant Market is a first-party WebMCP test service.
 *
 * It exists to prove tool discovery, schema translation, invocation and
 * synchronised state against a real site. It is labelled a test environment
 * everywhere it is visible, because pretending to be a merchant would be a
 * lie, and a demo built on a lie is worth nothing.
 *
 * The `exposedTo` grant below is the entire reason Dusky can read these tools.
 * Remove it and Dusky sees nothing, which is the correct default.
 */

const DEFAULT_AGENT_ORIGIN = import.meta.env["VITE_DUSKY_ORIGIN"] ?? "http://localhost:7803";

export function App() {
  const [cart, setCart] = useState<Product[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"pending" | "ready" | "unavailable">("pending");

  // The tools close over cart state, so keep a ref the callbacks can read
  // without forcing a re-registration on every mutation.
  const cartRef = useRef<Product[]>(cart);
  cartRef.current = cart;

  const note = useCallback((line: string) => {
    setLog((l) => [...l.slice(-40), line]);
  }, []);

  useEffect(() => {
    const agentOrigin = new URLSearchParams(location.search).get("agent") ?? DEFAULT_AGENT_ORIGIN;

    // Created synchronously so a StrictMode double-invoke cannot leave the
    // first registration pass alive long enough to collide with the second.
    const lifetime = new AbortController();

    const total = () => cartRef.current.reduce((s, c) => s + c.price, 0);

    registerTools(
      [
        {
          name: "search_products",
          title: "Search catalog",
          description:
            "Search the product catalog by free text. Returns matching products with ids and prices.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "What are you looking for?" } },
            required: ["query"],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ query }) => {
            const q = String(query ?? "").toLowerCase();
            const results = CATALOG.filter(
              (p) => p.name.toLowerCase().includes(q) || p.tags.includes(q),
            );
            note(`search_products("${q}") -> ${results.length} results`);
            return JSON.stringify({ results });
          },
        },
        {
          name: "add_to_cart",
          title: "Add to cart",
          description: "Add a product to the shopping cart by product id. Charged at checkout.",
          inputSchema: {
            type: "object",
            properties: { product_id: { type: "string", description: "Which product?" } },
            required: ["product_id"],
          },
          annotations: { readOnlyHint: false },
          execute: async ({ product_id }) => {
            const p = CATALOG.find((x) => x.id === product_id);
            if (!p) throw new Error(`no such product: ${String(product_id)}`);
            setCart((c) => [...c, p]);
            note(`add_to_cart("${p.id}") -> cart now ${cartRef.current.length + 1}`);
            return JSON.stringify({
              ok: true,
              added: p.name,
              cart_size: cartRef.current.length + 1,
              cart_total: Number((total() + p.price).toFixed(2)),
            });
          },
        },
        {
          name: "review_cart",
          title: "Review cart",
          description: "Look at what is currently in the cart. Does not change anything.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: true },
          execute: async () => {
            note(`review_cart() -> ${cartRef.current.length} items`);
            return JSON.stringify({
              items: cartRef.current.map((c) => ({ id: c.id, name: c.name, price: c.price })),
              total: Number(total().toFixed(2)),
            });
          },
        },
        {
          name: "empty_cart",
          title: "Empty cart",
          description: "Remove everything from the cart. This cannot be undone.",
          inputSchema: { type: "object", properties: {} },
          annotations: { readOnlyHint: false },
          execute: async () => {
            const n = cartRef.current.length;
            setCart([]);
            note(`empty_cart() -> removed ${n}`);
            return JSON.stringify({ ok: true, removed: n });
          },
        },
      ],
      { exposedTo: [agentOrigin], signal: lifetime.signal },
    )
      .then(() => {
        if (lifetime.signal.aborted) return;
        setStatus("ready");
        note(`registered 4 tools, exposedTo ${agentOrigin}`);
      })
      .catch((err: unknown) => {
        if (lifetime.signal.aborted) return;
        setStatus("unavailable");
        note(err instanceof Error ? err.message : String(err));
      });

    return () => lifetime.abort();
  }, [note]);

  const total = cart.reduce((s, c) => s + c.price, 0);

  return (
    <main className={styles.page}>
      <p className={styles.banner}>Test environment &middot; not a real merchant</p>

      <header className={styles.head}>
        <h1 className={styles.title}>Verdant Market</h1>
        <p className={styles.sub}>
          A first-party WebMCP service built to exercise Dusky&rsquo;s tool discovery, schema
          translation and synchronised state. Nothing here is sold.
        </p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.h2}>Catalog</h2>
        <ul className={styles.list}>
          {CATALOG.map((p) => (
            <li key={p.id} className={styles.row}>
              <span>{p.name}</span>
              <span className={styles.num}>{money(p.price)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Cart</h2>
        <p className={styles.cart} data-testid="cart">
          {cart.length ? (
            <>
              <strong>{cart.map((c) => c.name).join(", ")}</strong>
              <span className={styles.num}> {money(total)}</span>
            </>
          ) : (
            "empty"
          )}
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>
          Tool activity
          <span className={styles.status} data-status={status}>
            {status === "ready" ? "4 tools registered" : status}
          </span>
        </h2>
        <pre className={styles.log}>{log.length ? log.join("\n") : "waiting for an agent"}</pre>
      </section>
    </main>
  );
}
