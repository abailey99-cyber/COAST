/** Light/dark theme choice for the staff app (handoff §7.1: dark by default). */

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "coast-theme";
export const DEFAULT_APP_THEME: Theme = "dark";

export function parseTheme(value: string | null | undefined, fallback: Theme = DEFAULT_APP_THEME): Theme {
  return value === "light" || value === "dark" ? value : fallback;
}
