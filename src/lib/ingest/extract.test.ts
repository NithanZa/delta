import { describe, expect, it } from "vitest";
import { extractReadable, normalizeWhitespace, toIsoDate, readabilityLostContent } from "./extract";

const article = `<!doctype html><html><head>
<title>How a Small Agency Uses Buffer</title>
<meta property="article:published_time" content="2022-08-01T10:00:00Z">
</head><body>
<nav>Home Pricing Blog</nav>
<article>
<h1>How a Small Agency Uses Buffer</h1>
<p>${"Tempt is a boutique marketing agency that manages ten clients from one Buffer account. ".repeat(12)}</p>
<p>${"The team schedules posts, replies to comments and pulls monthly reports for each client. ".repeat(12)}</p>
</article>
<footer>Copyright</footer>
</body></html>`;

const landing = `<!doctype html><html><head><title>Buffer for Agencies</title>
<script type="application/ld+json">{"@type":"FAQPage","datePublished":"2023-06-03","mainEntity":[]}</script>
<style>.x{color:red}</style></head><body>
<header>Buffer</header>
<h1>Buffer for Agencies</h1>
<div>Agency plans start at $120 per month for up to 10 channels. Any additional channels cost $6 per month.</div>
<div>${"Manage every client from one place. ".repeat(20)}</div>
<script>window.__DATA__ = {}</script>
</body></html>`;

describe("extractReadable", () => {
  it("extracts article title, text and published date from meta", () => {
    const r = extractReadable(article, "https://buffer.com/resources/agency/");
    expect(r.title).toContain("How a Small Agency Uses Buffer");
    expect(r.text).toContain("boutique marketing agency");
    expect(r.text).not.toContain("Home Pricing Blog");
    expect(r.publishedAt).toBe("2022-08-01");
  });

  it("falls back to body text for landing pages and reads JSON-LD dates", () => {
    const r = extractReadable(landing, "https://buffer.com/agency");
    expect(r.title).toBe("Buffer for Agencies");
    expect(r.text).toContain("Agency plans start at $120 per month");
    expect(r.text).not.toContain("window.__DATA__");
    expect(r.text).not.toContain("color:red");
    expect(r.publishedAt).toBe("2023-06-03");
  });

  it("returns null publishedAt when no date is present", () => {
    const r = extractReadable("<html><head><title>x</title></head><body><p>" + "hello ".repeat(200) + "</p></body></html>", "https://a.com");
    expect(r.publishedAt).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes whitespace", () => {
    expect(normalizeWhitespace("a  b\n\n\n\n c \t d\r\n")).toBe("a b\n\nc d");
  });
  it("parses dates", () => {
    expect(toIsoDate("2024-02-01T00:00:00Z")).toBe("2024-02-01");
    expect(toIsoDate("nope")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe("pricing pages where Readability picks the FAQ", () => {
  const faq = Array.from({ length: 6 }, (_, i) => `<p>Question ${i}: can I change my plan later? Yes, you can switch your plans or downgrade your subscription anytime you want, and support is available across mail, chat and the mobile app whenever you need it.</p>`).join("");
  const plans = ["Essentials", "Standard", "Premium", "Ultimate"].map((p, i) => `<div class="plan"><span>${p}</span><span>$${(i + 1) * 25}/mo</span><span>$${(i + 1) * 30} billed monthly</span></div>`).join("");

  it("keeps the plan table instead of only the FAQ", () => {
    const html = `<html><head><title>Plans | Acme</title></head><body><nav>Home Pricing Login</nav><div id="plans">${plans}</div><article>${faq}</article><footer>Terms</footer></body></html>`;
    const out = extractReadable(html, "https://acme.example/plans");
    expect(out.text).toContain("$100/mo");
    expect(out.text).toContain("Ultimate");
    expect(out.text).toContain("can I change my plan");
    expect(out.text).not.toContain("Terms");
    expect(out.title).toBe("Plans | Acme");
  });

  it("still uses Readability for articles that mention a price in passing", () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i} of a long article about how agencies schedule content for their clients and report the results every month to the people who pay them.</p>`).join("");
    const html = `<html><head><title>Post</title></head><body><aside>Related: Pricing from $5 a month</aside><article><h1>Post</h1>${paragraphs}</article></body></html>`;
    const out = extractReadable(html, "https://acme.example/blog/post");
    expect(out.text).toContain("Paragraph 7");
    expect(out.text).not.toContain("Related:");
  });

  it("decides on prices and on lost text", () => {
    const body = "x".repeat(2000);
    expect(readabilityLostContent("FAQ only", "$1 $2 $3 $4 $5 and the FAQ")).toBe(true);
    expect(readabilityLostContent("$1 $2 $3 $4 kept most", "$1 $2 $3 $4 $5 and the FAQ")).toBe(false);
    expect(readabilityLostContent("y".repeat(500), body)).toBe(true);
    expect(readabilityLostContent("y".repeat(1500), body)).toBe(false);
  });
});
