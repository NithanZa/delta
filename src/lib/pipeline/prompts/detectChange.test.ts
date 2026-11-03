import { describe, expect, it } from "vitest";
import { cadenceSwitchNote, detectChangeUserPrompt, dominantCadence, PRICE_MOVE } from "./detectChange";

const diff = (removed: string[], added: string[]) => ({ removed, added, prevUnits: removed.length, curUnits: added.length, filtered: false });

describe("cadence switch detection", () => {
  it("recognises the dominant cadence of a set of lines", () => {
    expect(dominantCadence(["$12/ monthly for 1 channel", "Billed monthly", "Team features"])).toBe("monthly");
    expect(dominantCadence(["$10/ monthly for 1 channel Billed at $144 $120 yearly", "Starts at $100/mo (Billed at $1200/yr)"])).toBe("yearly");
    expect(dominantCadence(["Threads Profiles", "Bluesky Profiles"])).toBeNull();
  });

  it("adds a note only when the two captures display prices on different cadences", () => {
    const switched = diff(["Agency $120/ monthly for 10 channels Billed monthly"], ["Agency $100/ monthly for 10 channels Billed at $1440 $1,200 yearly"]);
    expect(cadenceSwitchNote(switched)).toMatch(/billed monthly .* billed yearly/);
    const prompt = detectChangeUserPrompt("https://buffer.com/pricing", { publishedAt: "2023-12-01", extractedText: "" }, { publishedAt: "2024-08-16", extractedText: "" }, switched);
    expect(prompt).toContain("NOT price changes");

    expect(cadenceSwitchNote(diff(["Agency $120/ monthly Billed monthly"], ["Agency $100/ monthly Billed monthly"]))).toBeNull();
    expect(cadenceSwitchNote(diff(["Threads Profiles"], ["Bluesky Profiles"]))).toBeNull();
  });
});

describe("PRICE_MOVE", () => {
  it("matches claimed price moves and ignores cadence-only or feature statements", () => {
    expect(PRICE_MOVE.test("Between 2023-12-01 and 2024-08-16 the Agency plan monthly price dropped from $120/mo to $100/mo")).toBe(true);
    expect(PRICE_MOVE.test("Buffer cut paid plan pricing: Essentials from $6/mo to $5/mo per channel")).toBe(true);
    expect(PRICE_MOVE.test("Between 2023-12-01 and 2024-08-16 the page switched from displaying monthly prices to yearly prices")).toBe(false);
    expect(PRICE_MOVE.test("Between 2023-12-01 and 2024-08-16 Threads Profiles and Bluesky Profiles were added as supported channels")).toBe(false);
  });
});
