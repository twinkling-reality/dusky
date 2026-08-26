import { type DisplayFrame, SESSION_CODE_ALPHABET, SESSION_CODE_LENGTH } from "@dusky/contracts";
import { FrameView } from "@dusky/lens";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./App.module.css";
import { useRelay } from "./useRelay.js";

/**
 * Dusky on Meta Ray-Ban Display.
 *
 * The wearer never waits on the network to know a gesture registered. A
 * selection paints locally the instant it lands, and the server's real frame
 * replaces it when it arrives. Leaving someone staring at an unchanged screen
 * on a device with no cursor is the one failure mode we refuse.
 */

const RELAY_URL = import.meta.env["VITE_RELAY_URL"] ?? "ws://localhost:7900/display";

/**
 * The alphabet lives in @dusky/contracts, because the website mints codes too
 * now and two alphabets that drifted apart would produce codes one surface
 * could not display legibly. What it cost to learn is recorded there.
 */
function mintCode(): string {
  const bytes = new Uint8Array(SESSION_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => SESSION_CODE_ALPHABET[b % SESSION_CODE_ALPHABET.length]).join("");
}

function readSessionId(): string {
  const q = new URLSearchParams(location.search).get("session");
  if (q) return q.toUpperCase();
  const stored = localStorage.getItem("dusky.session");
  if (stored) return stored;
  const fresh = mintCode();
  localStorage.setItem("dusky.session", fresh);
  return fresh;
}

export function App() {
  const sessionId = useMemo(readSessionId, []);
  const relay = useRelay(RELAY_URL, sessionId);
  const [pendingChoice, setPendingChoice] = useState<string | null>(null);

  // A real frame supersedes the local acknowledgement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frameKey is the trigger, not a read value: a new frame must clear the local ack
  useEffect(() => {
    setPendingChoice(null);
  }, [relay.frameKey]);

  const choose = useCallback(
    (choiceId: string) => {
      setPendingChoice(choiceId);
      relay.choose(choiceId);
    },
    [relay],
  );

  const frame = relay.frame ?? pairingFrame(sessionId, relay.link);

  return (
    <div className={styles.root}>
      <FrameView
        frame={frame}
        frameKey={relay.frameKey}
        onChoose={choose}
        onBack={relay.back}
        onText={relay.submitText}
      />

      {/* Gesture acknowledged, work still in flight. Local, never networked. */}
      {pendingChoice !== null && <div className={styles.pending} aria-live="polite" />}

      {relay.link !== "open" && (
        <div className={styles.link} data-state={relay.link}>
          {relay.link === "offline" ? "no connection" : "reconnecting"}
        </div>
      )}
    </div>
  );
}

/** Shown before a console has paired: one glance, one number. */
function pairingFrame(sessionId: string, link: string): DisplayFrame {
  if (link === "offline") {
    return {
      kind: "error",
      source: "Dusky",
      title: "Cannot reach Dusky",
      detail: "The session relay is unreachable.",
      retryable: true,
      choices: [{ id: "__retry", label: "Try again", meta: "enter" }],
    };
  }
  // The CODE is the content of this frame, so it gets the frame's largest and
  // brightest slot. It used to sit inside the note, which is the smallest text
  // on the panel, which is how one character got misread.
  return {
    kind: "idle",
    source: "Dusky",
    title: sessionId,
    note: "Enter this code in Dusky in your browser",
    choices: [],
  };
}
