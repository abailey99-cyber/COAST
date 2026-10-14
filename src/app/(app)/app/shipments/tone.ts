import type { Tone } from "@/lib/logic/shipments";

/** Status pill classes. Status is never colour alone: the label always goes with it. */
export const TONE_CLASS: Record<Tone, string> = {
  ok: "status-ok",
  warn: "status-warn",
  bad: "status-bad",
  neutral: "status-neutral",
};
