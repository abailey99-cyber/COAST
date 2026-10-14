"use client";

import { useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/logic/theme";
import styles from "./shell.module.css";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function choose(next: Theme) {
    setTheme(next);
    document.querySelector("[data-app-theme]")?.setAttribute("data-theme", next);
    // Remembered in a cookie straight away, so the server renders the same theme next time.
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
  }

  return (
    <div role="group" aria-label="Theme" className={styles.themeToggle}>
      <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>Light</button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>Dark</button>
    </div>
  );
}
