/** What the public /r/* routes share. These pages sit outside the dashboard password, so a signed token is their only auth. */

// A small per-IP limit keeps abuse cheap.
const WINDOW_MS = 60_000;
const LIMIT = 60;
const hits = new Map<string, number[]>();

function limited(ip: string, now = Date.now()): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > LIMIT;
}

export const rateLimited = (request: Request) => limited(request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown");

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function page(body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Delta</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f3f4f6;margin:0;padding:32px 12px;color:#111827}main{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#374151}label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}input,textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px;padding:8px;font:inherit;font-size:14px}button{margin-top:12px;background:#0f766e;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}a{color:#0f766e}.note{background:#f0fdfa;border-radius:6px;padding:10px 12px}.bad{color:#b91c1c}</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const tooManyRequests = () => page("<h1>Too many requests</h1><p>Please try again in a minute.</p>", 429);
