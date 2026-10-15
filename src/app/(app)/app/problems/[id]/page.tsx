import Link from "next/link";
import { notFound } from "next/navigation";
import { loadProblem } from "@/server/problems";
import { PageHeader } from "../../PageHeader";
import ui from "../../ui.module.css";
import { LEVEL_CLASS } from "../level";
import { AddPhotosForm, AssignControl, DetailsForm, NoteForm, StatusForm } from "./ProblemControls";

export const metadata = { title: "Delivery problem" };

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const page = await loadProblem(id);
  if (!page) notFound();
  const p = page.item;

  return (
    <>
      <PageHeader title={`${p.what} · ${p.soNumber}`} subtitle={`${p.customer} · reported by ${p.via.toLowerCase()} ${p.raised}`}>
        <Link href={`/app/orders/${p.orderId}`} className="btn btn-secondary">Open order</Link>
        <Link href="/app/problems" className="btn btn-secondary">All problems</Link>
      </PageHeader>

      <div className={ui.split}>
        <div className={ui.main} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className={ui.panel} aria-labelledby="summary-title">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 id="summary-title" style={{ fontSize: 16 }}>What&apos;s wrong</h2>
              <span className={`status ${p.open ? LEVEL_CLASS[p.level] : "status-ok"}`}>● {p.status}{p.open ? ` · ${p.levelLabel.toLowerCase()} · ${p.wait}` : ""}</span>
            </div>
            <dl className={ui.kv}>
              <dt>Reported</dt>
              <dd>{p.via}{page.reporterName ? ` · ${page.reporterName}` : ""} · {p.raised}</dd>
              <dt>In their words</dt>
              <dd>{page.description ?? <span className={ui.muted}>Nothing written</span>}</dd>
              <dt>Items</dt>
              <dd>
                {page.lineDetail.length === 0 ? (
                  <span className={ui.muted}>The whole order</span>
                ) : (
                  page.lineDetail.map((l) => (
                    <div key={l.lineNo}>Line {l.lineNo} · {l.description}{l.quantity !== null ? ` · ${l.quantity} affected` : ""}</div>
                  ))
                )}
              </dd>
              {page.shipment && (
                <>
                  <dt>Shipment</dt>
                  <dd><Link href={`/app/shipments/${page.shipment.id}`}>{page.shipment.label}</Link></dd>
                </>
              )}
              <dt>Owner</dt>
              <dd>{p.owner ?? <span className={ui.muted}>Nobody yet</span>}</dd>
              <dt>Carrier claim</dt>
              <dd>
                {page.claimDeadlineLabel ? (
                  <>
                    By {page.claimDeadlineLabel}
                    {p.claim && <> · <span className={`status ${LEVEL_CLASS[p.claim.level]}`}>● {p.claim.label}</span></>}
                    {page.claimSubmitted && <div className={ui.muted}>Submitted {page.claimSubmitted}</div>}
                  </>
                ) : (
                  <span className={ui.muted}>No deadline — set a claim window for the carrier in Settings, or enter one below</span>
                )}
              </dd>
              {page.resolutionLabel && (
                <>
                  <dt>Resolution</dt>
                  <dd>
                    {page.resolutionLabel}
                    {page.rmaReference ? ` · RMA ${page.rmaReference}` : ""}
                    {page.replacementLine ? ` · replacement is line ${page.replacementLine}` : ""}
                    {page.resolutionNote && <div className={ui.muted}>{page.resolutionNote}</div>}
                  </dd>
                </>
              )}
              {page.customerSees && (
                <>
                  <dt>Customer sees</dt>
                  <dd>“{page.customerSees}” <span className={ui.muted}>· never the cause, the owner or who it&apos;s waiting on</span></dd>
                </>
              )}
            </dl>
          </section>

          {page.photos.length > 0 && (
            <section className={ui.panel} aria-labelledby="photos-title">
              <h2 id="photos-title" style={{ fontSize: 16 }}>Photos</h2>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {page.photos.map((ph) => (
                  <li key={ph.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {ph.url ? (
                      <a href={ph.url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived private links, not optimisable */}
                        <img src={ph.url} alt={`Photo: ${ph.name}`} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8, border: "1px solid var(--divider)" }} />
                      </a>
                    ) : (
                      <span className={ui.muted}>Photo unavailable</span>
                    )}
                    <span className={ui.muted} style={{ fontSize: 12 }}>{ph.by} · {ph.when}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {page.canManage && (
            <section className={ui.panel} aria-labelledby="work-title">
              <h2 id="work-title" style={{ fontSize: 16 }}>Work it through</h2>
              <AssignControl problemId={p.id} ownerId={page.ownerId} team={page.team} />
              <StatusForm problemId={p.id} current={page.statusKey} options={page.nextStatuses} resolutions={page.resolutions} hasResolution={page.resolution !== null} />
              <DetailsForm
                problemId={p.id}
                category={page.category}
                categories={page.categories}
                rootCause={page.rootCause ?? ""}
                rma={page.rmaReference ?? ""}
                claimDeadline={page.claimDeadline ?? ""}
                claimSubmitted={page.claimSubmitted !== null}
              />
              {page.photos.length < page.maxPhotos && <AddPhotosForm problemId={p.id} left={page.maxPhotos - page.photos.length} />}
            </section>
          )}
        </div>

        <aside className={`${ui.panel} ${ui.aside}`} aria-labelledby="history-title">
          <h2 id="history-title" style={{ fontSize: 16 }}>History</h2>
          {page.canManage && <NoteForm problemId={p.id} />}
          <ol className={ui.timeline}>
            {page.history.map((e, i) => (
              <li key={e.id}>
                <span className={`${ui.dot} ${i > 0 ? ui.dotOld : ""}`} aria-hidden="true" />
                <div>
                  <div className={ui.strong}>{e.text}</div>
                  <div className={ui.muted}>{e.who} · {e.when}</div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
