"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SOURCE_TYPES } from "@/db/schema";
import { Button, Spinner } from "@/components/ui";

export function AddUrlForm({ competitorId, slug }: { competitorId: number; slug: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<string>("blog");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ competitorId, url, sourceType }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult({
        ok: true,
        message: body.created
          ? `Saved "${body.snapshot.title || body.snapshot.url}" (${body.snapshot.extractedText.length.toLocaleString()} chars, dated ${body.snapshot.publishedAt}). It will be analyzed in the next run.`
          : "That page is already captured with identical content.",
      });
      setUrl("");
      router.refresh();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://… a page about ${slug}`}
          aria-label="Page URL"
          className="min-w-64 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} aria-label="Source type" className="rounded-md border border-line bg-bg px-2 py-2 text-sm">
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending || !url}>
          {pending ? (
            <>
              <Spinner /> Fetching…
            </>
          ) : (
            "Add URL"
          )}
        </Button>
      </div>
      {result && <p className={result.ok ? "text-sm text-ok" : "text-sm text-bad"}>{result.message}</p>}
    </form>
  );
}
