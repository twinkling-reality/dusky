import { registerTools } from "../../packages/webmcp/src/index.ts";

const DUSKY_ORIGIN = "http://localhost:7803";
const registration = document.getElementById("registration");
const lastSurvey = document.querySelector<HTMLElement>('[data-testid="last-survey"]');
const lifetime = new AbortController();

void registerTools(
  [
    {
      name: "estimate_shade",
      title: "Estimate shade",
      description: "Estimate canopy shade for a survey zone without changing it.",
      inputSchema: {
        type: "object",
        properties: {
          zone: {
            type: "string",
            enum: ["courtyard", "terrace", "garden"],
            description: "Which survey zone?",
          },
        },
        required: ["zone"],
      },
      annotations: { readOnlyHint: true },
      execute: async ({ zone }) => {
        const surveyZone = String(zone ?? "");
        const result = {
          survey_zone: surveyZone,
          shade_percent: surveyZone === "garden" ? 62 : 41,
          canopy_condition: "healthy",
        };
        if (lastSurvey) {
          lastSurvey.textContent = `${result.survey_zone}: ${result.shade_percent}% shade, ${result.canopy_condition}`;
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
