/**
 * Light, dark, or whatever the machine is set to.
 *
 * `packages/tokens` already defines all three states: the light palette on
 * `:root`, the dark one behind `prefers-color-scheme` for anyone who has NOT
 * chosen, and the same dark one behind `[data-theme="dark"]` for anyone who
 * has. All this has to do is set the attribute and remember the answer.
 *
 * The Display is exempt and always will be. Its palette is emitted light on an
 * additive waveguide, where black is the absence of a photon rather than a
 * dark colour, so there is no light version of it to offer.
 */

export type Theme = "system" | "light" | "dark";

const KEY = "dusky.theme";

export function readTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset["theme"] = theme;
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
}
