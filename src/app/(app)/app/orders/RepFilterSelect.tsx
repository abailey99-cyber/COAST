"use client";

import { useRouter } from "next/navigation";
import ui from "../ui.module.css";

/** "My orders" / "All reps" / one rep (decision E1). Changes the address, so the view can be bookmarked. */
export function RepFilterSelect({ value, reps, view, q }: { value: string; reps: { id: string; name: string }[]; view: string; q: string }) {
  const router = useRouter();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className={ui.muted}>Showing</span>
      <select
        className={ui.select}
        value={value}
        onChange={(e) => {
          const p = new URLSearchParams({ view, rep: e.target.value });
          if (q) p.set("q", q);
          router.push(`/app/orders?${p.toString()}`);
        }}
      >
        <option value="mine">My orders</option>
        <option value="all">All reps</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
    </label>
  );
}
