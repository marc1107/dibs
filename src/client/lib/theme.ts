import { createStore } from "./store";

export const THEME_PREFS = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
type Theme = "light" | "dark";

/** Same key and logic as public/theme-init.js, which applies the theme before the first paint. */
const STORAGE_KEY = "dibs-theme";
const THEME_COLORS: Record<Theme, string> = { light: "#f2f4f7", dark: "#0d1015" };

export function parseThemePref(value: string | null): ThemePref {
  return THEME_PREFS.find((p) => p === value) ?? "system";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

function readPref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** The appearance chosen on this device (not synced: each phone may want its own). */
export const themePref = createStore<ThemePref>(typeof window === "undefined" ? "system" : readPref());

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply() {
  const theme = resolveTheme(themePref.get(), darkQuery().matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Private mode without storage: the choice still applies until the app is closed.
  }
  themePref.set(pref);
  apply();
}

export function startTheme() {
  apply();
  darkQuery().addEventListener("change", apply);
}
