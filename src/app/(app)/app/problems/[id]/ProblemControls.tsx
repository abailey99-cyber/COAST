"use client";

import { useActionState, useState, useTransition } from "react";
import { withShrunkPhotos } from "@/components/photos";
import { addProblemNote, addProblemPhotos, assignProblem, changeProblemStatus, saveProblemDetails, type ProblemResult } from "@/server/problem-actions";
import ui from "../../ui.module.css";

export function Result({ result }: { result: ProblemResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <p className={ui.muted} role="status" style={{ margin: 0 }}>{result.message}</p>
  ) : result.error ? (
    <p className={ui.fieldError} role="alert" style={{ margin: 0 }}>{result.error}</p>
  ) : null;
}

const block = { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--divider)", paddingTop: 12 } as const;

export function AssignControl({ problemId, ownerId, team }: { problemId: string; ownerId: string | null; team: { id: string; name: string }[] }) {
  const [value, setValue] = useState(ownerId ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProblemResult | null>(null);
  return (
    <div style={block}>
      <label htmlFor="problem-owner" className={ui.strong} style={{ fontSize: 14 }}>Owner</label>
      <select
        id="problem-owner"
        className={ui.input}
        style={{ maxWidth: 320 }}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          setResult(null);
          startTransition(async () => setResult(await assignProblem(problemId, next)));
        }}
      >
        <option value="">Nobody yet</option>
        {team.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <Result result={result} />
    </div>
  );
}

export function StatusForm({
  problemId,
  current,
  options,
  resolutions,
  hasResolution,
}: {
  problemId: string;
  current: string;
  options: { value: string; label: string }[];
  resolutions: { value: string; label: string }[];
  hasResolution: boolean;
}) {
  const [state, action, pending] = useActionState(changeProblemStatus.bind(null, problemId), null as ProblemResult | null);
  const [to, setTo] = useState(options[0]?.value ?? "");
  const needsResolution = to === "resolved" || (to === "closed" && !hasResolution);
  return (
    <form action={action} style={block} key={current}>
      <label htmlFor="problem-status" className={ui.strong} style={{ fontSize: 14 }}>Move it on</label>
      <select id="problem-status" name="status" className={ui.input} style={{ maxWidth: 320 }} value={to} onChange={(e) => setTo(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {needsResolution && (
        <>
          <label htmlFor="problem-resolution" className={ui.label}>How was it resolved?{to === "closed" ? " (optional when closing)" : ""}</label>
          <select id="problem-resolution" name="resolution" className={ui.input} style={{ maxWidth: 320 }} defaultValue="">
            <option value="" disabled={to === "resolved"}>Choose…</option>
            {resolutions.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {to === "resolved" && (
            <>
              <label htmlFor="problem-rma" className={ui.label}>RMA or reference (optional)</label>
              <input id="problem-rma" name="rma" className={ui.input} style={{ maxWidth: 320 }} maxLength={100} />
              <label htmlFor="problem-resolution-note" className={ui.label}>Note (internal)</label>
              <textarea id="problem-resolution-note" name="resolutionNote" className={ui.input} rows={2} maxLength={2000} />
              <p className={ui.hint} style={{ margin: 0 }}>A replacement adds a new line to the order, copying the affected one.</p>
            </>
          )}
        </>
      )}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <Result result={state} />
    </form>
  );
}

export function DetailsForm({
  problemId,
  category,
  categories,
  rootCause,
  rma,
  claimDeadline,
  claimSubmitted,
}: {
  problemId: string;
  category: string;
  categories: { value: string; label: string }[];
  rootCause: string;
  rma: string;
  claimDeadline: string;
  claimSubmitted: boolean;
}) {
  const [state, action, pending] = useActionState(saveProblemDetails.bind(null, problemId), null as ProblemResult | null);
  return (
    <details style={block}>
      <summary className={ui.strong} style={{ fontSize: 14, cursor: "pointer" }}>Details (internal)</summary>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <label htmlFor="problem-category" className={ui.label}>What&apos;s wrong</label>
        <select id="problem-category" name="category" className={ui.input} style={{ maxWidth: 320 }} defaultValue={category}>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <label htmlFor="problem-root-cause" className={ui.label}>Root cause</label>
        <textarea id="problem-root-cause" name="rootCause" className={ui.input} rows={2} maxLength={2000} defaultValue={rootCause} />
        <label htmlFor="problem-details-rma" className={ui.label}>RMA or reference</label>
        <input id="problem-details-rma" name="rma" className={ui.input} style={{ maxWidth: 320 }} maxLength={100} defaultValue={rma} />
        <label htmlFor="problem-claim-deadline" className={ui.label}>Carrier claim deadline</label>
        <input id="problem-claim-deadline" name="claimDeadline" type="date" className={ui.input} style={{ maxWidth: 200 }} defaultValue={claimDeadline} />
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="claimSubmitted" defaultChecked={claimSubmitted} /> Claim submitted to the carrier
        </label>
        <p className={ui.hint} style={{ margin: 0 }}>None of this is ever shown to the customer.</p>
        <div>
          <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Saving…" : "Save details"}</button>
        </div>
        <Result result={state} />
      </form>
    </details>
  );
}

export function NoteForm({ problemId }: { problemId: string }) {
  const [state, action, pending] = useActionState(async (prev: ProblemResult | null, fd: FormData) => addProblemNote(problemId, prev, fd), null as ProblemResult | null);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }} key={state?.ok ? state.message : "note"}>
      <label htmlFor="problem-note" className="visually-hidden">Add a note</label>
      <textarea id="problem-note" name="note" className={ui.input} rows={2} maxLength={2000} placeholder="Add a note (internal)" />
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Adding…" : "Add note"}</button>
      </div>
      <Result result={state} />
    </form>
  );
}

export function AddPhotosForm({ problemId, left }: { problemId: string; left: number }) {
  const [state, action, pending] = useActionState(async (prev: ProblemResult | null, fd: FormData): Promise<ProblemResult> => {
    const shrunk = await withShrunkPhotos(fd);
    return typeof shrunk === "string" ? { ok: false, error: shrunk } : addProblemPhotos(problemId, prev, shrunk);
  }, null as ProblemResult | null);
  return (
    <form action={action} style={block} key={state?.ok ? state.message : "photos"}>
      <label htmlFor="problem-photos" className={ui.strong} style={{ fontSize: 14 }}>Add photos</label>
      <input id="problem-photos" name="photos" type="file" accept="image/*" multiple className={ui.input} />
      <p className={ui.hint} style={{ margin: 0 }}>JPEG, PNG or WebP — up to {left} more.</p>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button>
      </div>
      <Result result={state} />
    </form>
  );
}
