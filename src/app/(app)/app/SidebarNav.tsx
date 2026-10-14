"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeSectionKey } from "@/lib/logic/navigation";
import styles from "./shell.module.css";

export function SidebarNav({ sections }: { sections: { key: string; label: string; href: string }[] }) {
  const active = activeSectionKey(usePathname());
  return (
    <ul className={styles.navList}>
      {sections.map((s) => (
        <li key={s.key}>
          <Link href={s.href} className={styles.navItem} aria-current={active === s.key ? "page" : undefined}>
            {s.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
