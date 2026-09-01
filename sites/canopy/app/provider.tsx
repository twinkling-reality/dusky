'use client';

import { Check, Leaf, ScanSearch } from 'lucide-react';
import { useEffect, useState } from 'react';

const DUSKY_ORIGINS = [
  'https://dusky-console.vercel.app',
  'http://localhost:7803',
];

type ToolInput = Record<string, unknown>;

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute(input: ToolInput): Promise<string>;
    },
    options: { exposedTo: string[]; signal: AbortSignal },
  ): Promise<void>;
}

type RegistrationState = 'registering' | 'ready' | 'unavailable' | 'error';

function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

export function CanopyProvider() {
  const [registration, setRegistration] = useState<RegistrationState>('registering');
  const [lastSurvey, setLastSurvey] = useState<{ zone: string; shade: number } | null>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    const context = modelContext();

    if (!context) {
      queueMicrotask(() => setRegistration('unavailable'));
      return () => lifetime.abort();
    }

    void context
      .registerTool(
        {
          name: 'estimate_shade',
          title: 'Estimate shade',
          description: 'Estimate canopy shade for a survey zone without changing it.',
          inputSchema: {
            type: 'object',
            properties: {
              zone: {
                type: 'string',
                enum: ['courtyard', 'terrace', 'garden'],
                description: 'Which survey zone?',
              },
            },
            required: ['zone'],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ zone }) => {
            const surveyZone = typeof zone === 'string' ? zone : '';
            const shadePercent =
              surveyZone === 'garden' ? 62 : surveyZone === 'terrace' ? 48 : 41;
            setLastSurvey({ zone: surveyZone, shade: shadePercent });
            return JSON.stringify({
              survey_zone: surveyZone,
              shade_percent: shadePercent,
              canopy_condition: 'healthy',
            });
          },
        },
        { exposedTo: DUSKY_ORIGINS, signal: lifetime.signal },
      )
      .then(() => setRegistration('ready'))
      .catch(() => {
        if (!lifetime.signal.aborted) setRegistration('error');
      });

    return () => lifetime.abort();
  }, []);

  const isReady = registration === 'ready';

  return (
    <main className="provider-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <section className="provider-card" aria-labelledby="provider-title">
        <header className="provider-header">
          <div className="brand-mark" aria-hidden="true">
            <Leaf strokeWidth={1.8} />
          </div>
          <div>
            <p className="eyebrow">Public WebMCP provider</p>
            <h1 id="provider-title">Canopy Lab</h1>
          </div>
          <output className={`status status-${registration}`}>
            <span className="status-dot" aria-hidden="true" />
            {isReady
              ? 'Ready for Dusky'
              : registration === 'registering'
                ? 'Connecting'
                : 'Browser only'}
          </output>
        </header>

        <div className="provider-body">
          <div className="intro">
            <p className="lede">
              A live fourth website for proving that Dusky can discover and run a tool supplied at
              runtime.
            </p>
            <div className="grant">
              <Check aria-hidden="true" />
              Authorized for the public Dusky console
            </div>
          </div>

          <article className="tool-card">
            <div className="tool-icon" aria-hidden="true">
              <ScanSearch strokeWidth={1.8} />
            </div>
            <div className="tool-copy">
              <p className="tool-label">Available action</p>
              <h2>Estimate shade</h2>
              <p>
                Choose a courtyard, terrace, or garden. The action returns a read-only canopy
                estimate.
              </p>
            </div>
            <span className="read-only">Read only</span>
          </article>

          <output
            className={`survey-result${lastSurvey ? ' has-result' : ''}`}
            aria-live="polite"
            data-testid="last-survey"
          >
            <span>{lastSurvey ? 'Latest Dusky request' : 'Waiting for a Dusky request'}</span>
            <strong>
              {lastSurvey
                ? `${lastSurvey.zone} · ${lastSurvey.shade}% shade · healthy`
                : 'No survey has run yet'}
            </strong>
          </output>

          {registration === 'unavailable' ? (
            <p className="browser-note">
              This page is live. Tool discovery appears when it is opened through Dusky in a
              WebMCP-capable browser.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
