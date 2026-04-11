import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("alisio", 16)).toBe("alisio");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("alisio-status-output", 10)).toBe("alisio-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});
