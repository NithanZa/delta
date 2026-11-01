"use client";

import { Button } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border border-bad/40 bg-bad/10 p-6">
      <h2 className="font-semibold text-bad">Something went wrong loading this competitor</h2>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      <Button variant="ghost" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
