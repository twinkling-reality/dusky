/**
 * The console origins this site authorizes, and the shape it registers against.
 *
 * One list, imported by every page that registers a tool. Two lists that drifted
 * apart would authorize the console on one page and silently refuse it on
 * another, which reads to a visitor as "that action does not exist here".
 */

export const DUSKY_ORIGINS = [
  'https://dusky-console.vercel.app',
  'http://localhost:7803',
];

export type ToolInput = Record<string, unknown>;

export interface ModelContext {
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

export function modelContext(): ModelContext | undefined {
  return (document as Document & { modelContext?: ModelContext }).modelContext;
}

export type RegistrationState = 'registering' | 'ready' | 'unavailable' | 'error';
