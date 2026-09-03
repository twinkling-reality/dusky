import { registerTools } from "../../packages/webmcp/src/index.ts";

/**
 * A provider whose required arguments happen to be a coordinate.
 *
 * The point of this fixture is what it does NOT contain. There is no Dusky
 * schema extension, no context object and no ambient parameter, because WebMCP
 * has none to offer: `executeTool` receives the site's own declared input and
 * an AbortSignal, and nothing else. A wearer's position can therefore only
 * ever reach a site as an argument the site itself asked for, which is what
 * makes the transfer decision the right consent boundary for one.
 */

const DUSKY_ORIGIN = "http://localhost:7803";
const registration = document.getElementById("registration");
const lastSurvey = document.querySelector<HTMLElement>('[data-testid="last-survey"]');
const geo = document.querySelector<HTMLElement>('[data-testid="site-geolocation"]');
const lifetime = new AbortController();

/**
 * What this page can see for itself, recorded for the test that asks.
 *
 * The console mounts providers with `allow="tools"` and nothing else, and
 * Permissions Policy defaults every feature to `self`. So this call is
 * expected to fail with PERMISSION_DENIED and no prompt even when the top
 * level page holds the grant. That is the property the whole design rests on:
 * a site gets the wearer's position when the wearer approves sending it, and
 * never by reading it.
 */
if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition(
    (fix) => {
      if (geo) geo.textContent = `read ${fix.coords.latitude}, ${fix.coords.longitude}`;
    },
    (error) => {
      if (geo) geo.textContent = `refused code ${error.code}`;
    },
    { timeout: 5000 },
  );
} else if (geo) {
  geo.textContent = "refused code 0";
}

void registerTools(
  [
    {
      name: "survey_point",
      title: "Survey a point",
      description: "Report canopy shade at a coordinate without changing anything.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitude?" },
          longitude: { type: "number", description: "Longitude?" },
        },
        required: ["latitude", "longitude"],
      },
      annotations: { readOnlyHint: true },
      execute: async ({ latitude, longitude }) => {
        const result = {
          survey_point: `${latitude}, ${longitude}`,
          shade_percent: 57,
          canopy_condition: "healthy",
        };
        if (lastSurvey) {
          lastSurvey.textContent = `${result.survey_point}: ${result.shade_percent}% shade, ${result.canopy_condition}`;
        }
        return JSON.stringify(result);
      },
    },
  ],
  { exposedTo: [DUSKY_ORIGIN], signal: lifetime.signal },
)
  .then(() => {
    if (registration) registration.textContent = "One WebMCP tool is ready.";
  })
  .catch((error: unknown) => {
    if (registration) {
      registration.textContent = error instanceof Error ? error.message : String(error);
    }
  });

window.addEventListener("pagehide", () => lifetime.abort(), { once: true });
