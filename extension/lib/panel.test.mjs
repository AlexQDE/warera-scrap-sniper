import { describe, it, expect } from "vitest";
import { headHtml } from "./panel.mjs";

describe("the bar's head", () => {
  it("shows the quote's state as a coloured dot and its age, the word only in the tooltip", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const html = headHtml({
      at: new Date(now - 5000).toISOString(),
      now,
      status: "fresh",
      tabs: ["market"],
    });
    expect(html).toContain('data-status="fresh"');
    expect(html).toContain('title="prices fresh"');
    expect(html).toContain("●");
    expect(html).toContain("5s ago");
    expect(html).not.toContain("fresh ·");
  });
});
