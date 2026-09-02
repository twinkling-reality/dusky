'use client';

import { ArrowUpRight, Leaf, MapPin, SunMedium, Trees } from 'lucide-react';
import { useEffect, useState } from 'react';

const DUSKY_ORIGINS = [
  'https://dusky-console.vercel.app',
  'http://localhost:7803',
];

type SurveyZone = 'courtyard' | 'terrace' | 'garden';
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

type ZoneProfile = {
  label: string;
  shade: number;
  peak: string;
  note: string;
};

const ZONES: Record<SurveyZone, ZoneProfile> = {
  courtyard: {
    label: 'Courtyard',
    shade: 41,
    peak: '11:40–14:10',
    note: 'Filtered midday cover',
  },
  terrace: {
    label: 'Terrace',
    shade: 48,
    peak: '12:20–15:00',
    note: 'Balanced afternoon cover',
  },
  garden: {
    label: 'Garden',
    shade: 62,
    peak: '10:50–15:40',
    note: 'Deepest sustained cover',
  },
};

function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

function isSurveyZone(value: unknown): value is SurveyZone {
  return typeof value === 'string' && value in ZONES;
}

export function CanopyProvider() {
  const [registration, setRegistration] =
    useState<RegistrationState>('registering');
  const [selectedZone, setSelectedZone] = useState<SurveyZone>('courtyard');
  const [lastSurvey, setLastSurvey] = useState<{
    zone: SurveyZone;
    shade: number;
  } | null>(null);

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
          description:
            'Estimate canopy shade for a survey zone without changing it.',
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
            const surveyZone: SurveyZone = isSurveyZone(zone)
              ? zone
              : 'courtyard';
            const shadePercent = ZONES[surveyZone].shade;
            setSelectedZone(surveyZone);
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

  const profile = ZONES[selectedZone];
  const circumference = 2 * Math.PI * 104;
  const dashOffset = circumference * (1 - profile.shade / 100);

  function estimateSelectedZone() {
    setLastSurvey({ zone: selectedZone, shade: profile.shade });
  }

  return (
    <main className="site-shell" data-tool-state={registration}>
      <header className="site-header">
        <a className="wordmark" href="#study" aria-label="Canopy Lab home">
          <span className="wordmark-mark" aria-hidden="true">
            <Leaf />
          </span>
          <span>
            <strong>Canopy Lab</strong>
            <small>Shade studies</small>
          </span>
        </a>

        <div className="site-location">
          <MapPin aria-hidden="true" />
          <span>Riverside block</span>
          <span aria-hidden="true">·</span>
          <span>40.71° N</span>
        </div>

        <div className="season-tag">
          <SunMedium aria-hidden="true" />
          <span>Summer model</span>
          <strong>2026</strong>
        </div>
      </header>

      <section
        className="study-workspace"
        id="study"
        aria-labelledby="study-title"
      >
        <article className="study-brief">
          <div className="study-index">
            <span>Site study</span>
            <strong>04</strong>
          </div>

          <div className="brief-copy">
            <p className="eyebrow">Planting intelligence</p>
            <h1 id="study-title">Measure where shade holds.</h1>
            <p className="lede">
              Compare sustained canopy cover before choosing a planting zone.
              Each estimate uses the same midsummer daylight window.
            </p>
          </div>

          <div className="zone-control" aria-label="Survey zone">
            <p>Survey zone</p>
            <div className="zone-options">
              {(Object.keys(ZONES) as SurveyZone[]).map((zone, index) => (
                <button
                  type="button"
                  className={selectedZone === zone ? 'is-active' : undefined}
                  aria-pressed={selectedZone === zone}
                  onClick={() => setSelectedZone(zone)}
                  key={zone}
                >
                  <span>0{index + 1}</span>
                  <strong>{ZONES[zone].label}</strong>
                  <small>{ZONES[zone].shade}% cover</small>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="estimate-button"
            onClick={estimateSelectedZone}
          >
            <span>Estimate {profile.label.toLowerCase()} shade</span>
            <ArrowUpRight aria-hidden="true" />
          </button>

          <div className="method-note">
            <Trees aria-hidden="true" />
            <p>
              <strong>Study method</strong>
              <span>Solar exposure · 10:00–16:00 · Healthy canopy</span>
            </p>
          </div>
        </article>

        <article
          className="shade-instrument"
          aria-label={`${profile.label} shade estimate`}
        >
          <header className="instrument-header">
            <div>
              <p>Active zone</p>
              <h2>{profile.label}</h2>
            </div>
            <span className="condition">
              <i aria-hidden="true" />
              Healthy canopy
            </span>
          </header>

          <div className="dial-wrap">
            <svg
              className="shade-dial"
              viewBox="0 0 280 280"
              aria-label={`${profile.shade}% shade`}
            >
              <title>{`${profile.shade}% sustained canopy shade`}</title>
              <circle className="dial-field" cx="140" cy="140" r="104" />
              <circle
                className="dial-progress"
                cx="140"
                cy="140"
                r="104"
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset: dashOffset,
                }}
              />
              <path className="sun-path" d="M63 184 C96 79, 181 52, 229 137" />
              <circle className="sun-node" cx="197" cy="74" r="10" />
              <line x1="140" y1="18" x2="140" y2="35" />
              <line x1="262" y1="140" x2="245" y2="140" />
              <line x1="140" y1="262" x2="140" y2="245" />
              <line x1="18" y1="140" x2="35" y2="140" />
            </svg>

            <div className="dial-reading">
              <span>Shade</span>
              <strong>{profile.shade}</strong>
              <small>%</small>
            </div>
          </div>

          <div className="instrument-metrics">
            <div>
              <span>Peak cover</span>
              <strong>{profile.peak}</strong>
            </div>
            <div>
              <span>Profile</span>
              <strong>{profile.note}</strong>
            </div>
          </div>

          <output
            className="survey-result"
            aria-live="polite"
            data-testid="last-survey"
          >
            <span>{lastSurvey ? 'Latest estimate' : 'Current preview'}</span>
            <strong>
              {lastSurvey
                ? `${lastSurvey.zone} · ${lastSurvey.shade}% shade · healthy`
                : `${profile.label} · ${profile.shade}% shade · healthy`}
            </strong>
          </output>
        </article>
      </section>

      <footer className="site-footer">
        <span>Canopy Lab</span>
        <span>Site shade intelligence for planting teams</span>
      </footer>
    </main>
  );
}
