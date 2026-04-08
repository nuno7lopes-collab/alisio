import { describe, expect, it } from "vitest";
import { AlisioSchema } from "./zod-schema.js";

describe("AlisioSchema logging levels", () => {
  it("accepts valid logging level values for level and consoleLevel", () => {
    expect(() =>
      AlisioSchema.parse({
        logging: {
          level: "debug",
          consoleLevel: "warn",
        },
      }),
    ).not.toThrow();
  });

  it("rejects invalid logging level values", () => {
    expect(() =>
      AlisioSchema.parse({
        logging: {
          level: "loud",
        },
      }),
    ).toThrow();
    expect(() =>
      AlisioSchema.parse({
        logging: {
          consoleLevel: "verbose",
        },
      }),
    ).toThrow();
  });
});
