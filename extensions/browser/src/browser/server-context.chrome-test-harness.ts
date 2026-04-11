import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/alisio" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchAlisioChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveAlisioUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopAlisioChrome: vi.fn(async () => {}),
}));
