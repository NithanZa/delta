/**
 * SSRF guard for user-supplied URLs: http(s) only, no loopback, link-local,
 * private or metadata hosts. Used by "Add URL", onboarding and reply parsing.
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    throw new UnsafeUrlError("Local hostnames are not allowed");
  }
  if (isPrivateIpv4(host)) throw new UnsafeUrlError("Private IP addresses are not allowed");
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, link-local, unique-local, IPv4-mapped privates.
    if (host === "::1" || host === "::" || /^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host) || /^::ffff:/i.test(host)) throw new UnsafeUrlError("Private IP addresses are not allowed");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URLs are not allowed");
  return url;
}

export function isPublicHttpUrl(input: string): boolean {
  try {
    assertPublicHttpUrl(input);
    return true;
  } catch {
    return false;
  }
}
