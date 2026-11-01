import { describe, expect, it } from "vitest";
import { diffUnits, splitUnits } from "./diff";

describe("diffUnits", () => {
  it("returns only the lines that differ, ignoring whitespace and quote style", () => {
    const prev = "Pricing\nAgency plan $120/mo for 10 channels\nTeam plan $12/mo per channel\nFooter text here";
    const cur = "Pricing\nAgency plan $100/mo for 10 channels\nTeam  plan $12/mo per channel\nFooter text here";
    const d = diffUnits(prev, cur);
    expect(d.removed).toEqual(["Agency plan $120/mo for 10 channels"]);
    expect(d.added).toEqual(["Agency plan $100/mo for 10 channels"]);
  });

  it("is empty for identical captures", () => {
    const text = "Agency plan $120/mo for 10 channels\nTeam plan $12/mo per channel";
    const d = diffUnits(text, text);
    expect(d.removed).toEqual([]);
    expect(d.added).toEqual([]);
  });

  it("splits long lines into sentences", () => {
    const units = splitUnits("First sentence is here. Second sentence follows it. ".repeat(6) + "Tail sentence ends the paragraph.");
    expect(units.length).toBeGreaterThan(3);
    expect(units[0]).toBe("First sentence is here.");
  });
});
