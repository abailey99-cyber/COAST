"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Lockup } from "@/components/brand/Lockup";
import { activeSectionKey } from "@/lib/logic/navigation";
import styles from "./shell.module.css";

/**
 * The staff app's main menu: three lines that turn from horizontal to
 * vertical as the menu drops down, and back as it closes. Closes on Escape,
 * on a click outside, and when you go to another page. The COAST lockup sits
 * beside it and goes Home.
 */
export function AppMenu({
  sections,
  children,
}: {
  sections: { key: string; label: string; href: string; badge?: number }[];
  /** Shown under the links: carrier card, who's signed in, sign out. */
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activeSectionKey(pathname);
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const waiting = sections.reduce((n, s) => n + (s.badge ?? 0), 0);

  // A new page closes the menu.
  if (open && openedAt !== pathname) {
    setOpen(false);
    setOpenedAt(pathname);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={root} className={styles.menuRoot}>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => {
          setOpen((o) => !o);
          setOpenedAt(pathname);
        }}
      >
        <span className={styles.burger} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {waiting > 0 && !open && (
          <span className={styles.navBadge} aria-hidden="true">{waiting}</span>
        )}
      </button>
      <Link href="/app/home" className={styles.homeLink} aria-label="COAST home">
        <Lockup />
      </Link>
      <div id={menuId} className={styles.menuPanel} hidden={!open}>
        <ul className={styles.navList}>
          {sections.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className={styles.navItem} aria-current={active === s.key ? "page" : undefined} onClick={() => setOpen(false)}>
                {s.label}
                {s.badge ? (
                  <span className={styles.navBadge}>
                    {s.badge}
                    <span className="visually-hidden"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        {children}
      </div>
    </div>
  );
}
