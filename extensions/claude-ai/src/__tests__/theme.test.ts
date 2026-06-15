// Tests for luminanceToTheme — the core of "match the page's light/dark".
// This is the shared, canonical formula (the content-script observer uses it;
// background.ts keeps an inline mirror in its executeScript pull-path).

import { describe, expect, it } from "vitest";

import { luminanceToTheme } from "../lib/theme";

describe("luminanceToTheme", () => {
  it("reads pure white as light, pure black as dark", () => {
    expect(luminanceToTheme("rgb(255, 255, 255)")).toBe("light");
    expect(luminanceToTheme("rgb(0, 0, 0)")).toBe("dark");
  });

  it("classifies claude.ai's real surfaces correctly", () => {
    // Anthropic warm paper (light theme) and warm-dark canvas (dark theme).
    expect(luminanceToTheme("rgb(245, 244, 238)")).toBe("light"); // #F5F4EE
    expect(luminanceToTheme("rgb(38, 38, 36)")).toBe("dark"); // #262624
  });

  it("classifies the SkillNote panel's own tokens correctly", () => {
    expect(luminanceToTheme("rgb(247, 246, 241)")).toBe("light"); // --bg-page light
    expect(luminanceToTheme("rgb(38, 37, 34)")).toBe("dark"); // --bg-page dark
  });

  it("handles rgba() (ignores alpha)", () => {
    expect(luminanceToTheme("rgba(255, 255, 255, 0.9)")).toBe("light");
    expect(luminanceToTheme("rgba(20, 20, 20, 1)")).toBe("dark");
  });

  it("sits on the right side of the 128 luma threshold", () => {
    // Luma = 0.299r+0.587g+0.114b. Gray 130 → 130 ≥ 128 → light.
    expect(luminanceToTheme("rgb(130, 130, 130)")).toBe("light");
    // Gray 120 → 120 < 128 → dark.
    expect(luminanceToTheme("rgb(120, 120, 120)")).toBe("dark");
  });

  it("weights green heavily (luma, not naive average)", () => {
    // Pure green 255 → luma 0.587*255 ≈ 150 ≥ 128 → light.
    expect(luminanceToTheme("rgb(0, 255, 0)")).toBe("light");
    // Pure blue 255 → luma 0.114*255 ≈ 29 < 128 → dark.
    expect(luminanceToTheme("rgb(0, 0, 255)")).toBe("dark");
  });

  it("returns the fallback for unparseable colors", () => {
    expect(luminanceToTheme("transparent", "dark")).toBe("dark");
    expect(luminanceToTheme("transparent", "light")).toBe("light");
    expect(luminanceToTheme("", "dark")).toBe("dark");
    expect(luminanceToTheme("rgb(0, 0)", "light")).toBe("light"); // too few channels
  });

  it("defaults the fallback to light when omitted", () => {
    expect(luminanceToTheme("not-a-color")).toBe("light");
  });
});
