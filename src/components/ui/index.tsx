import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-surface p-4", className)}>
      {children}
    </section>
  );
}

const badgeTones = {
  neutral: "border-line text-muted",
  accent: "border-accent/40 text-accent",
  ok: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  bad: "border-bad/40 text-bad",
  info: "border-info/40 text-info",
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: BadgeTone; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50",
    ghost: "border border-line text-fg hover:bg-surface-2 disabled:opacity-50",
    danger: "border border-bad/40 text-bad hover:bg-bad/10 disabled:opacity-50",
  }[variant];
  return (
    <button className={cx("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed", styles, className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-2", className)}>
      {children}
    </Link>
  );
}

export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2" title={`${pct}% confidence`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="confidence">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{label ?? `${pct}%`}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-t-accent", className)}
      role="status"
      aria-label="loading"
    />
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
