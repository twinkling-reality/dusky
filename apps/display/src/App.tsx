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

  // Superseded overrides whatever was last on screen. Keeping the old frame
  // would leave the wearer looking at a live-seeming panel whose every control
  // now belongs to a session being driven somewhere else.
  const frame =
    relay.link === "superseded"
      ? supersededFrame()
      : relay.link === "rejected"
        ? rejectedFrame(sessionId)
        : (relay.frame ?? pairingFrame(sessionId, relay.link));

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

      {relay.link !== "open" && relay.link !== "superseded" && relay.link !== "rejected" && (
        <div className={styles.link} data-state={relay.link}>
          {relay.link === "offline" ? "no connection" : "reconnecting"}
        </div>
      )}
    </div>
  );
}

/**
 * Shown when something else claimed this session.
 *
 * No retry, deliberately. Reconnecting here would evict whatever took over,
 * which would then reconnect and evict this, which is exactly the exchange
 * that used to rebuild the wearer's screen several times a second. There is
 * genuinely nothing to do on this device, so it says so rather than offering
 * a control that would restart the fight.
 */
function supersededFrame(): DisplayFrame {
  return {
    kind: "error",
    source: "Dusky",
    title: "Another window took over",
    detail: "This session is being shown somewhere else. Close that one to use it here.",
    retryable: false,
    choices: [],
  };
}

/**
 * Shown when the session id in the URL is not a pairing code.
 *
 * Only reachable by hand: the Display mints its own code, so this means
 * somebody typed or pasted one. No retry, because the relay will refuse it
 * every time and a client that keeps asking is just a loop with a spinner.
 */
function rejectedFrame(sessionId: string): DisplayFrame {
  return {
    kind: "error",
    source: "Dusky",
    title: "Not a pairing code",
    detail: `${sessionId} is not a code this can use. Open this page without one and it will make its own.`,
    retryable: false,
    choices: [],
  };
}

/** Shown before a console has paired: one glance, one number. */
function pairingFrame(sessionId: string, link: string): DisplayFrame {
  if (link === "offline") {
    // No "Try again" here, deliberately.
    //
    // It used to offer one, and it was the only control on the frame, so it
    // was the focused one. Pressing it called `relay.choose`, which calls
    // `send`, which DROPS the message when the socket is not open. Nothing
    // went anywhere, so no frame came back, so `frameKey` never changed, so
    // the local gesture acknowledgement never cleared and the hairline swept
    // forever. The wearer's only affordance looked like it had hung the
    // panel.
    //
    // `useRelay` is already retrying on its own, forever, at four seconds a
    // go. Saying so is both true and more useful than a button that cannot
    // reach anything by definition.
    return {
      kind: "error",
      source: "Dusky",
      title: "Cannot reach Dusky",
      detail: "The session relay is unreachable. Still trying.",
      retryable: false,
      choices: [],
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
