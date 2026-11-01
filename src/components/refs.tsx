import type { ReactNode } from "react";

/** Turn inline F12 / H3 / Q2 / E5 references in model prose into links. */
export function linkRefs(text: string, slug: string): ReactNode[] {
  return text.split(/\b([FHQE]\d+)\b/).map((part, i) => {
    const m = part.match(/^([FHQE])(\d+)$/);
    if (!m) return part;
    const [, kind, id] = m;
    const href =
      kind === "F"
        ? `/c/${slug}?tab=evidence&facts=${id}`
        : kind === "H"
          ? `/c/${slug}?tab=overview#h-${id}`
          : kind === "Q"
            ? `/c/${slug}?tab=questions#q-${id}`
            : `/c/${slug}?tab=timeline#e-${id}`;
    return (
      <a key={i} href={href} className="text-accent hover:underline">
        {part}
      </a>
    );
  });
}
