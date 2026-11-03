"use client";

import { useActionState } from "react";
import type { Feed, Source } from "@/db/schema";
import { FEED_KINDS, SOURCE_TYPES } from "@/db/schema";
import { Badge, Button, cx, domainOf, fmtDate } from "@/components/ui";
import { addFeed, addProposed, addWatchSource, proposeWatchlistAction, setFeedEnabled, updateSource, type ProposalState, type SettingsState } from "./actions";

const initial: SettingsState = { ok: true, message: "" };
const inputCls = "rounded-md border border-line bg-bg px-2 py-1.5 text-sm focus:border-accent focus:outline-none";
const INTERVALS = [
  [24, "daily"],
  [72, "every 3 days"],
  [168, "weekly"],
] as const;

function Status({ state }: { state: SettingsState }) {
  if (!state.message) return null;
  return <span className={state.ok ? "text-xs text-ok" : "text-xs text-bad"}>{state.message}</span>;
}

function SourceRow({ source }: { source: Source }) {
  const [state, action, pending] = useActionState(updateSource, initial);
  return (
    <form action={action} className={cx("grid gap-2 rounded-md border border-line p-3 text-sm", !source.enabled && "opacity-60")}>
      <input type="hidden" name="sourceId" value={source.id} />
      <div className="flex flex-wrap items-center gap-2">
        <a href={source.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-accent hover:underline" title={source.url}>
          {source.title || source.url.replace(/^https?:\/\//, "")}
        </a>
        <Badge>{source.sourceType.replace("_", " ")}</Badge>
        <Badge tone="neutral">{source.provider}</Badge>
        {source.lastError && (
          <Badge tone="bad" className="max-w-xs truncate" >
            error: {source.lastError}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{domainOf(source.url)}</span>
        <span>· last checked {source.lastCheckedAt ? fmtDate(source.lastCheckedAt) : "never"}</span>
        <span>· last change {source.lastChangedAt ? fmtDate(source.lastChangedAt) : "—"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="watch" defaultChecked={source.watch} /> watch
        </label>
        <select name="checkIntervalHours" defaultValue={source.checkIntervalHours} aria-label="Check interval" className={inputCls}>
          {INTERVALS.map(([h, label]) => (
            <option key={h} value={h}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={source.enabled} /> enabled
        </label>
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function AddWatchSourceForm({ competitorId }: { competitorId: number }) {
  const [state, action, pending] = useActionState(addWatchSource, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="competitorId" value={competitorId} />
      <input name="url" type="text" inputMode="url" required placeholder="https://competitor.com/pricing" aria-label="Page URL to watch" className={cx(inputCls, "min-w-64 flex-1")} />
      <select name="sourceType" defaultValue="pricing" aria-label="Source type" className={inputCls}>
        {SOURCE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.replace("_", " ")}
          </option>
        ))}
      </select>
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Adding…" : "Watch page"}
      </Button>
      <Status state={state} />
    </form>
  );
}

function FeedRow({ feed }: { feed: Feed }) {
  const [state, action, pending] = useActionState(setFeedEnabled, initial);
  return (
    <form action={action} className={cx("flex flex-wrap items-center gap-2 rounded-md border border-line p-3 text-sm", !feed.enabled && "opacity-60")}>
      <input type="hidden" name="feedId" value={feed.id} />
      <input type="hidden" name="enabled" value={feed.enabled ? "0" : "1"} />
      <a href={feed.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-accent hover:underline" title={feed.url}>
        {feed.url.replace(/^https?:\/\//, "")}
      </a>
      <Badge>{feed.kind.replace("_", " ")}</Badge>
      <span className="text-xs text-muted">last checked {feed.lastCheckedAt ? fmtDate(feed.lastCheckedAt) : "never"}</span>
      <span className="text-xs text-muted">· newest item {feed.lastItemAt ? fmtDate(feed.lastItemAt) : "—"}</span>
      {feed.lastError && <Badge tone="bad">error: {feed.lastError.slice(0, 60)}</Badge>}
      <Button type="submit" variant="ghost" disabled={pending} className="ml-auto">
        {pending ? "…" : feed.enabled ? "Disable" : "Enable"}
      </Button>
      <Status state={state} />
    </form>
  );
}

export function AddFeedForm({ competitorId }: { competitorId: number }) {
  const [state, action, pending] = useActionState(addFeed, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="competitorId" value={competitorId} />
      <input name="url" type="text" inputMode="url" required placeholder="https://competitor.com/blog/rss.xml" aria-label="Feed or sitemap URL" className={cx(inputCls, "min-w-64 flex-1")} />
      <select name="kind" defaultValue="rss" aria-label="Feed kind" className={inputCls}>
        {FEED_KINDS.map((k) => (
          <option key={k} value={k}>
            {k.replace("_", " ")}
          </option>
        ))}
      </select>
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "Adding…" : "Add feed"}
      </Button>
      <Status state={state} />
    </form>
  );
}

const initialProposal: ProposalState = { ok: true, message: "" };

export function ProposeWatchlistForm({ competitorId, website }: { competitorId: number; website: string }) {
  const [state, propose, proposing] = useActionState(proposeWatchlistAction, initialProposal);
  const [added, add, adding] = useActionState(addProposed, initial);
  return (
    <div className="grid gap-3">
      <form action={propose} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="competitorId" value={competitorId} />
        <Button type="submit" variant="ghost" disabled={proposing || !website}>
          {proposing ? "Probing the site…" : "Propose watchlist"}
        </Button>
        <span className="text-xs text-muted">{website ? `Probes ${domainOf(website)} for pricing, product, partner and blog pages, feeds and sitemaps (about 30 seconds).` : "Set the competitor's website first."}</span>
        <Status state={state} />
      </form>
      {state.proposal && (
        <form action={add} className="grid gap-2 rounded-md border border-dashed border-line p-3">
          <input type="hidden" name="competitorId" value={competitorId} />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pages ({state.proposal.pages.length})</p>
          {state.proposal.pages.map((p) => (
            <label key={p.url} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="page" value={`${p.url}|${p.sourceType}`} defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">{p.title || p.url}</span> <Badge>{p.sourceType.replace("_", " ")}</Badge>
                <br />
                <span className="text-xs text-muted">
                  {p.url} · {p.reason}
                </span>
              </span>
            </label>
          ))}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Feeds and sitemaps ({state.proposal.feeds.length})</p>
          {state.proposal.feeds.length === 0 && <p className="text-xs text-muted">None found.</p>}
          {state.proposal.feeds.map((f) => (
            <label key={f.url} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="feed" value={`${f.url}|${f.kind}`} defaultChecked={f.kind !== "sitemap_index"} className="mt-1" />
              <span>
                {f.url} <Badge>{f.kind.replace("_", " ")}</Badge> <span className="text-xs text-muted">· {f.reason}</span>
              </span>
            </label>
          ))}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={adding}>
              {adding ? "Adding…" : "Add selected"}
            </Button>
            <Status state={added} />
          </div>
        </form>
      )}
    </div>
  );
}

export function WatchlistSection({ competitorId, website, sources, feeds }: { competitorId: number; website: string; sources: Source[]; feeds: Feed[] }) {
  const watched = sources.filter((s) => s.watch);
  const unwatched = sources.filter((s) => !s.watch);
  return (
    <div className="grid gap-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Watchlist · {watched.length} page{watched.length === 1 ? "" : "s"} re-fetched on an interval
        </h3>
        <div className="grid gap-2">
          {watched.length === 0 && <p className="text-sm text-muted">No watched pages yet. Add one below or propose a watchlist from the site.</p>}
          {watched.map((s) => (
            <SourceRow key={s.id} source={s} />
          ))}
        </div>
        <div className="mt-2">
          <AddWatchSourceForm competitorId={competitorId} />
        </div>
        {unwatched.length > 0 && (
          <details className="mt-2">
            <summary className="text-xs text-muted hover:text-fg">
              Other known pages ({unwatched.length}) — tick “watch” to re-fetch them
            </summary>
            <div className="mt-2 grid gap-2">
              {unwatched.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </div>
          </details>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Feeds and sitemaps · {feeds.length}</h3>
        <div className="grid gap-2">
          {feeds.length === 0 && <p className="text-sm text-muted">No feeds yet. New blog posts and release notes are found through these.</p>}
          {feeds.map((f) => (
            <FeedRow key={f.id} feed={f} />
          ))}
        </div>
        <div className="mt-2">
          <AddFeedForm competitorId={competitorId} />
        </div>
      </div>
      <ProposeWatchlistForm competitorId={competitorId} website={website} />
    </div>
  );
}
