import Link from "next/link";
import styles from "./marketing.module.css";

// Hero copy is the approved wording from handoff §7.4.
export default function HomePage() {
  return (
    <section className={`${styles.hero} band-dark`} aria-labelledby="hero-title">
      <div className={styles.heroInner}>
        <p className="eyebrow">Centralised Order And Shipment Tracking</p>
        <h1 id="hero-title" className={styles.heroTitle}>Know where every order is, before your customer asks.</h1>
        <p className={styles.heroBody}>
          COAST follows each order from purchase order to doorstep. It chases suppliers for you, tracks every carrier in one
          place, and gives your customers an honest delivery date, even before anything has shipped.
        </p>
        <div className={styles.heroActions}>
          <Link href="/sign-in" className="btn btn-primary btn-lg">Sign in</Link>
        </div>
      </div>
    </section>
  );
}
