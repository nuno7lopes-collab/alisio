import { describe, expect, it } from "vitest";
import {
  buildCanvasScopedHostUrl,
  CANVAS_CAPABILITY_PATH_PREFIX,
  LEGACY_CANVAS_CAPABILITY_PATH_PREFIX,
  normalizeCanvasScopedUrl,
} from "./canvas-capability.js";

describe("canvas capability urls", () => {
  it("builds canonical scoped urls", () => {
    expect(buildCanvasScopedHostUrl("http://127.0.0.1:18789", "tok-1")).toBe(
      `http://127.0.0.1:18789${CANVAS_CAPABILITY_PATH_PREFIX}/tok-1`,
    );
  });

  it("normalizes canonical scoped urls into query-scoped paths", () => {
    expect(
      normalizeCanvasScopedUrl(
        `http://127.0.0.1:18789${CANVAS_CAPABILITY_PATH_PREFIX}/tok-1/__alisio__/a2ui/?platform=ios`,
      ),
    ).toEqual({
      pathname: "/__alisio__/a2ui/",
      capability: "tok-1",
      rewrittenUrl: "/__alisio__/a2ui/?platform=ios&oc_cap=tok-1",
      scopedPath: true,
      malformedScopedPath: false,
    });
  });

  it("accepts legacy scoped prefixes during the rollout window", () => {
    expect(
      normalizeCanvasScopedUrl(
        `http://127.0.0.1:18789${LEGACY_CANVAS_CAPABILITY_PATH_PREFIX}/tok-1/__openclaw__/a2ui/?platform=ios`,
      ),
    ).toEqual({
      pathname: "/__openclaw__/a2ui/",
      capability: "tok-1",
      rewrittenUrl: "/__openclaw__/a2ui/?platform=ios&oc_cap=tok-1",
      scopedPath: true,
      malformedScopedPath: false,
    });
  });

  it("flags malformed scoped urls", () => {
    expect(
      normalizeCanvasScopedUrl(`http://127.0.0.1:18789${CANVAS_CAPABILITY_PATH_PREFIX}/broken`),
    ).toEqual({
      pathname: `${CANVAS_CAPABILITY_PATH_PREFIX}/broken`,
      capability: undefined,
      rewrittenUrl: undefined,
      scopedPath: true,
      malformedScopedPath: true,
    });
  });
});
