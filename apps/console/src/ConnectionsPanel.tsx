import { WebMcpBridge } from "@dusky/webmcp";
import { type FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "./ConnectionsPanel.module.css";
import { addedSource, MAX_CONNECTED_SITES, originOf, SOURCES, type Source } from "./sources.js";

interface ConnectionsPanelProps {
  sites: readonly Source[];
  canChange: boolean;
  statusFor: (origin: string) => {
    label: string;
    state: "active" | "checking" | "empty" | "failed";
  };
  onApply: (sites: readonly Source[]) => void;
  onClose: () => void;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4.75 10.25 3.2 3.15 7.3-7.1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.25 5.25 9.5 9.5" />
      <path d="m14.75 5.25-9.5 9.5" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.6 12.4-1.35 1.35a3 3 0 0 1-4.25-4.25L4.5 7a3 3 0 0 1 4.25 0" />
      <path d="m12.4 7.6 1.35-1.35A3 3 0 1 1 18 10.5L15.5 13a3 3 0 0 1-4.25 0" />
      <path d="m3.5 3.5 13 13" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m12.75 4.75-5.25 5.25 5.25 5.25" />
      <path d="M7.75 10h8" />
    </svg>
  );
}

function AddWebsiteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.75v12.5M3.75 10h12.5" />
    </svg>
  );
}

function WebsiteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3.25" y="4" width="13.5" height="12.25" rx="2" />
      <path d="M3.25 7.25h13.5" />
      <path d="M6 5.65h.01M8 5.65h.01" />
    </svg>
  );
}

interface WebsiteProbe {
  source: Source;
  run: number;
}

const VERIFICATION_MESSAGES = [
  "Opening the page",
  "Checking access for this console",
  "Reading available actions",
] as const;

type VerificationFlow =
  | { step: "address" }
  | { step: "checking"; probe: WebsiteProbe; stage: 0 | 1 | 2 }
  | { step: "name"; candidate: Source; actionCount: number };

type VerificationAction =
  | { type: "reset" }
  | { type: "start"; probe: WebsiteProbe }
  | { type: "progress"; run: number; stage: 1 | 2 }
  | { type: "succeed"; run: number; candidate: Source; actionCount: number }
  | { type: "fail"; run: number };

function verificationReducer(
  state: VerificationFlow,
  action: VerificationAction,
): VerificationFlow {
  if (action.type === "reset") return { step: "address" };
  if (action.type === "start") return { step: "checking", probe: action.probe, stage: 0 };
  if (state.step !== "checking" || state.probe.run !== action.run) return state;
  if (action.type === "progress") {
    return { ...state, stage: Math.max(state.stage, action.stage) as 1 | 2 };
  }
  if (action.type === "succeed") {
    return {
      step: "name",
      candidate: action.candidate,
      actionCount: action.actionCount,
    };
  }
  return { step: "address" };
}

/**
 * Changes the provider documents kept alive by the console.
 *
 * A candidate is temporarily loaded for a real, origin-filtered WebMCP
 * discovery before it can be connected. Every accepted change is applied
 * immediately while the Display is idle because changing origins restarts the
 * relay-owned session.
 */
export function ConnectionsPanel({
  sites,
  canChange,
  statusFor,
  onApply,
  onClose,
}: ConnectionsPanelProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  const [adding, setAdding] = useState(false);
  const [verification, dispatchVerification] = useReducer(verificationReducer, {
    step: "address",
  });
  const shelf = useRef<HTMLDivElement | null>(null);
  const urlInput = useRef<HTMLInputElement | null>(null);
  const verificationRun = useRef(0);
  const activeVerification = useRef<number | null>(null);
  const checking = verification.step === "checking";
  const probe = verification.step === "checking" ? verification.probe : null;
  const candidate = verification.step === "name" ? verification.candidate : null;
  const verifiedActionCount = verification.step === "name" ? verification.actionCount : 0;
  const verificationStage = verification.step === "checking" ? verification.stage : 0;

  useEffect(() => {
    shelf.current?.focus({ preventScroll: true });
    return () => {
      activeVerification.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (adding) {
          setAdding(false);
          activeVerification.current = null;
          dispatchVerification({ type: "reset" });
          setProblem(null);
          setShowConnectionHelp(false);
          shelf.current?.focus({ preventScroll: true });
        } else {
          onClose();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        shelf.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (document.activeElement === shelf.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adding, onClose]);

  const selectedOrigins = useMemo(() => new Set(sites.map(originOf)), [sites]);
  const customSites = useMemo(() => {
    const byOrigin = new Map<string, Source>();
    for (const site of sites) {
      if (site.sample !== true) byOrigin.set(originOf(site), site);
    }
    return [...byOrigin.values()];
  }, [sites]);
  const knownCustomOrigins = useMemo(
    () => new Set(customSites.map((site) => originOf(site))),
    [customSites],
  );
  const catalogSites = useMemo(() => {
    const byOrigin = new Map<string, Source>();
    for (const site of [...SOURCES, ...customSites]) {
      const origin = originOf(site);
      if (!selectedOrigins.has(origin)) byOrigin.set(origin, site);
    }
    return [...byOrigin.values()];
  }, [customSites, selectedOrigins]);
  const urlProblem = problem !== null && adding;
  const cleanUrl = useMemo(() => {
    const source = addedSource(url, "");
    if (!source) return null;
    const parsed = new URL(source.url);
    if (!parsed.search && !parsed.hash) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }, [url]);

  const clearProblem = () => {
    setProblem(null);
    setShowConnectionHelp(false);
  };

  const reportProblem = (message: string, connectionHelp = false) => {
    setProblem(message);
    setShowConnectionHelp(connectionHelp);
  };

  const toggleSample = (sample: Source, checked: boolean) => {
    clearProblem();
    if (!canChange) {
      reportProblem("Finish the current Display choice before changing websites.");
      return;
    }
    const custom = sites.filter((site) => site.sample !== true);
    const selectedSampleIds = new Set(
      sites.filter((site) => site.sample === true).map((site) => site.id),
    );
    if (checked) selectedSampleIds.add(sample.id);
    else selectedSampleIds.delete(sample.id);
    const selectedSamples = SOURCES.filter((site) => selectedSampleIds.has(site.id));
    const next = [...selectedSamples, ...custom];
    if (next.length === 0) {
      reportProblem("Keep at least one website connected.");
      return;
    }
    if (next.length > MAX_CONNECTED_SITES) {
      reportProblem(`A browser session can hold up to ${MAX_CONNECTED_SITES} websites.`);
      return;
    }
    onApply(next);
  };

  const validateCandidate = (): Source | null => {
    const source = addedSource(url, "");
    if (!source) {
      reportProblem("Enter a public HTTPS URL. Localhost HTTP is allowed for development.");
      urlInput.current?.focus();
      return null;
    }
    const origin = originOf(source);
    if (origin === window.location.origin) {
      reportProblem("The Dusky console cannot be connected as a website source.");
      urlInput.current?.focus();
      return null;
    }
    if (selectedOrigins.has(origin)) {
      reportProblem("That website is already connected.");
      urlInput.current?.focus();
      return null;
    }
    if (knownCustomOrigins.has(origin)) {
      reportProblem("That website is already available under Reconnect.");
      urlInput.current?.focus();
      return null;
    }
    if (sites.length >= MAX_CONNECTED_SITES) {
      reportProblem(`A browser session can hold up to ${MAX_CONNECTED_SITES} websites.`);
      return null;
    }
    clearProblem();
    return source;
  };

  const verifyWebsite = (event: FormEvent) => {
    event.preventDefault();
    const source = validateCandidate();
    if (!source) return;
    const run = verificationRun.current + 1;
    verificationRun.current = run;
    activeVerification.current = run;
    clearProblem();
    dispatchVerification({ type: "start", probe: { source, run } });
  };

  const discoverCandidate = async (source: Source, run: number) => {
    const bridge = new WebMcpBridge([originOf(source)]);
    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (attempt === 2 && run === activeVerification.current) {
          dispatchVerification({ type: "progress", run, stage: 2 });
        }
        const tools = await bridge.discover();
        if (run !== activeVerification.current) return;
        if (tools.length > 0) {
          activeVerification.current = null;
          dispatchVerification({
            type: "succeed",
            run,
            candidate: source,
            actionCount: tools.length,
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (run !== activeVerification.current) return;
      activeVerification.current = null;
      reportProblem("This isn’t a supported connection page.", true);
      dispatchVerification({ type: "fail", run });
    } catch {
      if (run !== activeVerification.current) return;
      activeVerification.current = null;
      reportProblem("Dusky couldn’t check this page.", true);
      dispatchVerification({ type: "fail", run });
    }
  };

  const commitWebsite = (displayName: string) => {
    const checked = validateCandidate();
    if (!checked) return;
    if (!canChange) {
      reportProblem("Finish the current Display choice before connecting a website.");
      return;
    }
    const source = addedSource(url, displayName);
    if (!source) return;
    onApply([...sites, source]);
  };

  const addWebsite = (event: FormEvent) => {
    event.preventDefault();
    commitWebsite(name);
  };

  const returnToAddress = () => {
    activeVerification.current = null;
    dispatchVerification({ type: "reset" });
    setName("");
    clearProblem();
    requestAnimationFrame(() => urlInput.current?.focus());
  };

  const removeWebsite = (origin: string) => {
    if (sites.length === 1) {
      reportProblem("Keep at least one website connected.");
      return;
    }
    if (!canChange) {
      reportProblem("Finish the current Display choice before disconnecting a website.");
      return;
    }
    clearProblem();
    onApply(sites.filter((site) => originOf(site) !== origin));
  };

  const restoreWebsite = (site: Source) => {
    if (sites.length >= MAX_CONNECTED_SITES) {
      reportProblem(`A browser session can hold up to ${MAX_CONNECTED_SITES} websites.`);
      return;
    }
    if (!canChange) {
      reportProblem("Finish the current Display choice before reconnecting a website.");
      return;
    }
    clearProblem();
    onApply([...sites, site]);
  };

  const addFromCatalog = (id: string) => {
    const site = catalogSites.find((candidateSite) => candidateSite.id === id);
    if (!site) return;
    if (site.sample === true) toggleSample(site, true);
    else restoreWebsite(site);
  };

  const toggleAddPanel = () => {
    const next = !adding;
    activeVerification.current = null;
    setAdding(next);
    clearProblem();
    dispatchVerification({ type: "reset" });
    if (next) requestAnimationFrame(() => urlInput.current?.focus());
  };

  return (
    <div
      className={styles.workspace}
      data-testid="connections-workspace"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={shelf}
        className={styles.shelf}
        data-adding={adding || undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Websites"
        tabIndex={-1}
      >
        <section className={styles.panel} data-squircle="" data-testid="configured-websites-panel">
          <header className={styles.header}>
            <h2>Configured Websites</h2>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.addToggle}
                aria-expanded={adding}
                aria-controls="add-website-panel"
                onClick={toggleAddPanel}
                disabled={!canChange || sites.length >= MAX_CONNECTED_SITES}
              >
                <AddWebsiteIcon />
                <span>Add Website</span>
              </button>
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Close Configured Websites"
                data-tooltip="Close Configured Websites"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <div className={styles.body}>
            <ul className={styles.siteGrid} aria-label="Connected Websites">
              {sites.map((site) => {
                const origin = originOf(site);
                const status = statusFor(origin);
                return (
                  <li key={site.id} className={styles.siteCard} data-state={status.state}>
                    <span className={styles.siteIcon} aria-hidden="true">
                      <WebsiteIcon />
                    </span>
                    <span className={styles.connectionIdentity}>
                      <strong>{site.name}</strong>
                      <span>{origin}</span>
                    </span>
                    <span className={styles.connectionStatus} data-state={status.state}>
                      {status.label}
                    </span>
                    <button
                      type="button"
                      className={styles.disconnect}
                      onClick={() =>
                        site.sample === true ? toggleSample(site, false) : removeWebsite(origin)
                      }
                      aria-label={`Disconnect ${site.name}`}
                      data-tooltip={`Disconnect ${site.name}`}
                      disabled={!canChange}
                    >
                      <DisconnectIcon />
                    </button>
                  </li>
                );
              })}
            </ul>

            {catalogSites.length > 0 && (
              <label className={styles.restoreControl}>
                <span className={styles.restoreLabel}>
                  <AddWebsiteIcon />
                  <span>Reconnect</span>
                </span>
                <select
                  className={styles.catalogSelect}
                  value=""
                  onChange={(event) => addFromCatalog(event.target.value)}
                  aria-label="Reconnect a Configured Website"
                  disabled={!canChange}
                >
                  <option value="">Choose Website…</option>
                  {catalogSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {problem && !adding && (
              <div className={styles.problem} aria-live="polite">
                <span className={styles.failureMark} aria-hidden="true">
                  <CloseIcon />
                </span>
                <span>{problem}</span>
              </div>
            )}
          </div>
        </section>

        {adding && (
          <section
            id="add-website-panel"
            className={styles.addPanel}
            aria-labelledby="add-website-title"
            data-squircle=""
            data-testid="add-website-panel"
          >
            <header className={styles.addHeader}>
              <div className={styles.addTitleGroup}>
                <h3 id="add-website-title">Add Website</h3>
                <span className={styles.stepCount} aria-hidden="true">
                  {candidate ? "2 / 2" : "1 / 2"}
                </span>
                <span className={styles.visuallyHidden} aria-live="polite">
                  Step {candidate ? 2 : 1} of 2
                </span>
              </div>
              <button
                type="button"
                onClick={toggleAddPanel}
                aria-label="Close Add Website"
                data-tooltip="Close Add Website"
              >
                <CloseIcon />
              </button>
            </header>

            <form
              className={styles.addForm}
              data-step={candidate ? "name" : "address"}
              onSubmit={candidate ? addWebsite : verifyWebsite}
            >
              <div className={styles.carousel} aria-live="polite">
                {!candidate ? (
                  <section
                    key="address"
                    className={styles.slide}
                    data-direction="back"
                    aria-labelledby="url-step"
                  >
                    <div className={styles.stepHeader}>
                      <h4 id="url-step">Connect a Supported Site</h4>
                      <p>
                        The site must give you a connection link. Regular homepages, restaurant
                        pages, and chat URLs do not work by default.
                      </p>
                    </div>

                    <label className={styles.inputGroup}>
                      <span className={styles.visuallyHidden}>Website URL</span>
                      <span
                        className={styles.inputShell}
                        data-invalid={urlProblem || undefined}
                        data-long={url.length > 48 || undefined}
                      >
                        <span className={styles.fieldIcon} aria-hidden="true">
                          <WebsiteIcon />
                        </span>
                        <input
                          ref={urlInput}
                          type="url"
                          value={url}
                          onChange={(event) => {
                            setUrl(event.target.value);
                            if (problem) clearProblem();
                          }}
                          placeholder="Paste the connection link supplied by the site"
                          autoComplete="url"
                          aria-invalid={urlProblem || undefined}
                          aria-describedby={urlProblem ? "connections-feedback" : undefined}
                          required
                        />
                      </span>
                    </label>

                    {probe && (
                      <iframe
                        className={styles.preflightFrame}
                        src={probe.source.url}
                        title="Checking WebMCP Website"
                        allow="tools"
                        onLoad={() => {
                          dispatchVerification({ type: "progress", run: probe.run, stage: 1 });
                          void discoverCandidate(probe.source, probe.run);
                        }}
                        onError={() => {
                          if (probe.run !== activeVerification.current) return;
                          activeVerification.current = null;
                          reportProblem("Dusky couldn’t open this page.", true);
                          dispatchVerification({ type: "fail", run: probe.run });
                        }}
                      />
                    )}

                    {checking && (
                      <div className={styles.verificationProgress} role="status" aria-live="polite">
                        <span className={styles.progressOrb} aria-hidden="true" />
                        <span key={verificationStage} className={styles.progressMessage}>
                          {VERIFICATION_MESSAGES[verificationStage]}
                        </span>
                        <span className={styles.progressCount} aria-hidden="true">
                          {verificationStage + 1} / {VERIFICATION_MESSAGES.length}
                        </span>
                      </div>
                    )}

                    {problem && (
                      <div
                        id="connections-feedback"
                        className={styles.inlineProblem}
                        aria-live="polite"
                        data-guidance={showConnectionHelp || undefined}
                      >
                        <span className={styles.failureMark} aria-hidden="true">
                          <CloseIcon />
                        </span>
                        <span className={styles.failureCopy}>
                          <strong>{problem}</strong>
                          {showConnectionHelp && (
                            <small>
                              The site must expose actions and explicitly allow this Dusky console.
                              If it did not give you a specific connection link, it will not connect
                              here.
                            </small>
                          )}
                        </span>

                        {showConnectionHelp && cleanUrl && (
                          <button
                            type="button"
                            className={styles.recoveryChoice}
                            onClick={() => {
                              setUrl(cleanUrl);
                              clearProblem();
                              requestAnimationFrame(() => urlInput.current?.focus());
                            }}
                          >
                            <span>Try Without Tracking</span>
                            <small>Removes campaign tags; the page still must support Dusky.</small>
                          </button>
                        )}

                        {showConnectionHelp && catalogSites.length > 0 && (
                          <span className={styles.verifiedAlternatives}>
                            <small>Verified Here</small>
                            <span>
                              {catalogSites.slice(0, 2).map((site) => (
                                <button
                                  key={site.id}
                                  type="button"
                                  onClick={() => addFromCatalog(site.id)}
                                >
                                  {site.name}
                                </button>
                              ))}
                            </span>
                          </span>
                        )}

                        {showConnectionHelp && catalogSites.length === 0 && (
                          <small className={styles.verifiedHint}>
                            The websites on the left are verified examples you can use now.
                          </small>
                        )}
                      </div>
                    )}

                    <div className={styles.slideActions}>
                      <button
                        type="submit"
                        className={styles.verifyButton}
                        disabled={checking}
                        aria-busy={checking || undefined}
                      >
                        {checking ? "Verifying Connection" : "Verify Connection"}
                      </button>
                    </div>
                  </section>
                ) : (
                  <section
                    key="name"
                    className={styles.slide}
                    data-direction="forward"
                    aria-labelledby="name-step"
                  >
                    <div className={styles.stepHeader}>
                      <h4 id="name-step">Name This Website</h4>
                      <p>Optional. Used only as its label on the graph.</p>
                    </div>

                    <div className={styles.verifiedRow}>
                      <span className={styles.verifiedOrigin}>
                        <span className={styles.validationMark} aria-hidden="true">
                          <CheckIcon />
                        </span>
                        <span>
                          <strong>Verified</strong>
                          <small>
                            {originOf(candidate)} · {verifiedActionCount}{" "}
                            {verifiedActionCount === 1 ? "action" : "actions"}
                          </small>
                        </span>
                      </span>
                    </div>

                    <label className={styles.inputGroup}>
                      <span className={styles.visuallyHidden}>Display name (optional)</span>
                      <span className={styles.inputShell}>
                        <span className={styles.fieldIcon} aria-hidden="true">
                          <WebsiteIcon />
                        </span>
                        <input
                          type="text"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder={`Display name, e.g. ${candidate.name}`}
                          maxLength={48}
                          autoComplete="off"
                        />
                      </span>
                    </label>

                    {problem && (
                      <div
                        id="connections-feedback"
                        className={styles.inlineProblem}
                        aria-live="polite"
                      >
                        <span className={styles.failureMark} aria-hidden="true">
                          <CloseIcon />
                        </span>
                        <span className={styles.failureCopy}>
                          <strong>{problem}</strong>
                        </span>
                      </div>
                    )}

                    <div className={styles.slideActions} data-triple="">
                      <button
                        type="button"
                        className={styles.backButton}
                        onClick={(event) => {
                          event.preventDefault();
                          returnToAddress();
                        }}
                      >
                        <BackIcon />
                        <span>Back</span>
                      </button>
                      <button
                        type="button"
                        className={styles.skipButton}
                        onClick={() => commitWebsite("")}
                        disabled={!canChange}
                      >
                        Skip
                      </button>
                      <button type="submit" className={styles.addButton} disabled={!canChange}>
                        Add Website
                      </button>
                    </div>
                  </section>
                )}
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
