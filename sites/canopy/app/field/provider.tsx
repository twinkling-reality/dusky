'use client';

import { Compass, Leaf, MapPin, SunMedium } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DUSKY_ORIGINS,
  modelContext,
  type RegistrationState,
} from '../dusky';

/**
 * A survey that takes a point rather than a named zone.
 *
 * This page exists because a coordinate is the one argument a wearer should
 * never have to hand-write on a 600x600 panel. It declares `latitude` and
 * `longitude` because that is what those two numbers are called, not because
 * Dusky asked for a keyword: there is no Dusky-specific schema extension here
 * and nothing on this page knows how the value will be collected.
 *
 * It is a second page on the Canopy Lab origin rather than a second tool on the
 * home page, deliberately. The home page's single `estimate_shade` is what the
 * deployed round-trip proofs count, and a tool added beside it would have
 * changed those counts for a reason unrelated to what they check.
 */

interface Surveyed {
  latitude: number;
  longitude: number;
  shade: number;
}

/** Deterministic from the point, so the same coordinate always reads the same. */
function shadeAt(latitude: number, longitude: number): number {
  const spread = Math.abs(Math.sin(latitude * 1.7) + Math.cos(longitude * 1.3));
  return Math.round(38 + spread * 26);
}

function asCoordinate(value: unknown, limit: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < -limit || n > limit) return null;
  return n;
}

export function FieldProvider() {
  const [registration, setRegistration] =
    useState<RegistrationState>('registering');
  const [surveyed, setSurveyed] = useState<Surveyed | null>(null);

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
          name: 'survey_point',
          title: 'Survey a point',
          description:
            'Report canopy shade at a coordinate without changing anything.',
          inputSchema: {
            type: 'object',
            properties: {
              latitude: { type: 'number', description: 'Latitude?' },
              longitude: { type: 'number', description: 'Longitude?' },
            },
            required: ['latitude', 'longitude'],
          },
          annotations: { readOnlyHint: true },
          execute: async ({ latitude, longitude }) => {
            // The site validates its own input. Dusky checks the primitive
            // conversion it can see and does not enforce range for anybody.
            const lat = asCoordinate(latitude, 90);
            const lon = asCoordinate(longitude, 180);
            if (lat === null || lon === null) {
              return JSON.stringify({
                ok: false,
                error: 'That is not a point on Earth.',
              });
            }
            const shadePercent = shadeAt(lat, lon);
            setSurveyed({ latitude: lat, longitude: lon, shade: shadePercent });
            return JSON.stringify({
              survey_point: `${lat}, ${lon}`,
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

  return (
    <main className="site-shell" data-tool-state={registration}>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Canopy Lab home">
          <span className="wordmark-mark" aria-hidden="true">
            <Leaf />
          </span>
          <span>
            <strong>Canopy Lab</strong>
            <small>Field survey</small>
          </span>
        </a>

        <div className="site-location">
          <Compass aria-hidden="true" />
          <span>Anywhere you are standing</span>
        </div>

        <div className="season-tag">
          <SunMedium aria-hidden="true" />
          <span>Summer model</span>
          <strong>2026</strong>
        </div>
      </header>

      <section
        className="study-workspace"
        id="survey"
        aria-labelledby="survey-title"
      >
        <article className="study-brief">
          <div className="study-index">
            <span>Site study</span>
            <strong>05</strong>
          </div>

          <div className="brief-copy">
            <p className="eyebrow">Planting intelligence</p>
            <h1 id="survey-title">Shade at a point.</h1>
            <p className="lede">
              The zone study needs a named plot. This one takes a coordinate, so
              a surveyor standing in a field can ask about the ground under
              their feet instead of the nearest place with a name.
            </p>
          </div>

          <div className="method-note">
            <MapPin aria-hidden="true" />
            <p>
              <strong>Declared input</strong>
              <span>latitude · longitude · WGS84 decimal degrees</span>
            </p>
          </div>
        </article>

        <article className="shade-instrument" aria-label="Surveyed point">
          <header className="instrument-header">
            <div>
              <p>Surveyed point</p>
              <h2>{surveyed ? `${surveyed.latitude}, ${surveyed.longitude}` : 'None yet'}</h2>
            </div>
            <span className="condition">
              <i aria-hidden="true" />
              {registration === 'ready' ? 'Tool ready' : registration}
            </span>
          </header>

          <div className="instrument-metrics">
            <div>
              <span>Shade</span>
              <strong>{surveyed ? `${surveyed.shade}%` : '--'}</strong>
            </div>
            <div>
              <span>Condition</span>
              <strong>{surveyed ? 'Healthy canopy' : '--'}</strong>
            </div>
          </div>

          <output
            className="survey-result"
            aria-live="polite"
            data-testid="last-survey"
          >
            <span>{surveyed ? 'Latest survey' : 'Nothing surveyed'}</span>
            <strong>
              {surveyed
                ? `${surveyed.latitude}, ${surveyed.longitude}: ${surveyed.shade}% shade, healthy`
                : 'No survey has run.'}
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
