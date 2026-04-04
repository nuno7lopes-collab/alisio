/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY,
  ALISIO_CONNECTOR_OAUTH_STORAGE_KEY,
  LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY,
  buildAlisioConnectorOAuthSignal,
} from "../../../src/shared/alisio-connector-oauth.js";
import {
  buildPendingAlisioConnectorChatResume,
  readPendingAlisioConnectorChatResume,
  rememberAlisioConnectorOAuthReturnTo,
  rememberPendingAlisioConnectorChatResume,
  subscribeAlisioConnectorOAuthSignals,
} from "./alisio-connector-oauth.ts";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("subscribeAlisioConnectorOAuthSignals", () => {
  it("replays a pending connector OAuth signal already persisted in storage", () => {
    const signal = buildAlisioConnectorOAuthSignal({
      connectorId: "gmail-send",
      provider: "google",
    });
    window.localStorage.setItem(ALISIO_CONNECTOR_OAUTH_STORAGE_KEY, JSON.stringify(signal));
    const onSignal = vi.fn();

    const unsubscribe = subscribeAlisioConnectorOAuthSignals(onSignal);

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith(signal);
    unsubscribe();
  });

  it("deduplicates repeated delivery of the same signal id", () => {
    const signal = buildAlisioConnectorOAuthSignal({
      connectorId: "gmail-send",
      provider: "google",
    });
    const onSignal = vi.fn();

    const unsubscribe = subscribeAlisioConnectorOAuthSignals(onSignal);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ALISIO_CONNECTOR_OAUTH_STORAGE_KEY,
        newValue: JSON.stringify(signal),
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ALISIO_CONNECTOR_OAUTH_STORAGE_KEY,
        newValue: JSON.stringify(signal),
      }),
    );

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith(signal);
    unsubscribe();
  });

  it("ignores stale persisted OAuth signals from old sessions", () => {
    const signal = buildAlisioConnectorOAuthSignal(
      {
        connectorId: "gmail-send",
        provider: "google",
      },
      Date.now() - 10 * 60 * 1000,
    );
    window.localStorage.setItem(ALISIO_CONNECTOR_OAUTH_STORAGE_KEY, JSON.stringify(signal));
    const onSignal = vi.fn();

    const unsubscribe = subscribeAlisioConnectorOAuthSignals(onSignal);

    expect(onSignal).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("connector OAuth helpers", () => {
  it("stores a same-origin return target for non-popup OAuth redirects", () => {
    rememberAlisioConnectorOAuthReturnTo("/authentications?source=chat");
    const expectedUrl = new URL("/authentications?source=chat", window.location.href).toString();

    expect(window.localStorage.getItem(ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY)).toBe(
      expectedUrl,
    );
    expect(window.localStorage.getItem(LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY)).toBe(
      expectedUrl,
    );
  });

  it("persists and restores a pending chat replay after connector auth", () => {
    const now = Date.now();
    const pending = buildPendingAlisioConnectorChatResume({
      connectorId: "gmail-send",
      sessionKey: "agent:main",
      now,
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Need auth." }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Envia este email" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "data:image/png;base64,abc",
              },
            },
          ],
        },
      ],
    });

    expect(pending).toEqual({
      connectorId: "gmail-send",
      sessionKey: "agent:main",
      message: "Envia este email",
      attachments: [
        {
          id: "connector-auth-replay-1",
          dataUrl: "data:image/png;base64,abc",
          mimeType: "image/png",
        },
      ],
      createdAtMs: now,
    });

    rememberPendingAlisioConnectorChatResume(pending!);

    expect(readPendingAlisioConnectorChatResume()).toEqual(pending);
  });
});
