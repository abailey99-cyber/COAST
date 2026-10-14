"use client";

import { useState, useTransition } from "react";
import type { Theme } from "@/lib/logic/theme";
import { setAppTheme } from "@/server/theme-actions";
import styles from "./shell.module.css";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [, startTransition] = useTransition();

  function choose(next: Theme) {
    setTheme(next);
    // Instant feedback; the cookie keeps the choice for next time.
    document.querySelector("[data-app-theme]")?.setAttribute("data-theme", next);
    startTransition(() => setAppTheme(next));
  }

  return (
    <div role="group" aria-label="Theme" className={styles.themeToggle}>
      <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>Light</button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>Dark</button>
    </div>
  );
}
