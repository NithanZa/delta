import type { Metadata } from "next";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "About DeltaResearchBot" };

/** Linked from the crawler's user agent so site owners can see what it does. */
export default function AboutBotPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">About DeltaResearchBot</h1>
      <Card>
        <p className="text-sm leading-relaxed">
          DeltaResearchBot is the crawler of a Delta instance, an open-source competitive-intelligence tool. It re-fetches a short list of public pages
          (pricing, plans, product and partner pages) about one or two companies at most once a day, reads RSS, Atom and sitemap feeds to find new blog
          posts, and stores the readable text of those pages for analysis.
        </p>
        <ul className="mt-3 grid gap-1 text-sm text-muted">
          <li>It identifies itself with the user agent <code className="rounded bg-surface-2 px-1">DeltaResearchBot/0.2</code> and a link to this page.</li>
          <li>It honours <code className="rounded bg-surface-2 px-1">robots.txt</code> (user agents <code className="rounded bg-surface-2 px-1">DeltaResearchBot</code> and <code className="rounded bg-surface-2 px-1">*</code>), fetches one page at a time per host with a one-second gap, and uses conditional requests for feeds.</li>
          <li>It never submits forms, logs in, or fetches anything behind authentication.</li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed">
          To stop it from visiting your site, add <code className="rounded bg-surface-2 px-1">User-agent: DeltaResearchBot</code> followed by{" "}
          <code className="rounded bg-surface-2 px-1">Disallow: /</code> to your robots.txt, or contact the operator of this instance.
        </p>
      </Card>
    </div>
  );
}
