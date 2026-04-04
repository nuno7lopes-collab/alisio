/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSttActive, startStt, stopStt } from "./speech.ts";

class MockSpeechRecognition extends EventTarget {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  start = vi.fn(() => {
    this.dispatchEvent(new Event("start"));
  });
  stop = vi.fn(() => {
    this.dispatchEvent(new Event("end"));
  });
  abort = vi.fn();

  constructor() {
    super();
    MockSpeechRecognition.instances.push(this);
  }
}

function emitSpeechError(instance: MockSpeechRecognition, error: string): void {
  const event = new Event("error") as Event & { error: string };
  event.error = error;
  instance.dispatchEvent(event);
}

describe("speech STT", () => {
  const originalSpeechRecognition = (globalThis as Record<string, unknown>).SpeechRecognition;
  const originalWebkitSpeechRecognition = (globalThis as Record<string, unknown>)
    .webkitSpeechRecognition;

  beforeEach(() => {
    vi.useFakeTimers();
    MockSpeechRecognition.instances = [];
    (globalThis as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
    delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;
  });

  afterEach(() => {
    stopStt();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    if (originalSpeechRecognition === undefined) {
      delete (globalThis as Record<string, unknown>).SpeechRecognition;
    } else {
      (globalThis as Record<string, unknown>).SpeechRecognition = originalSpeechRecognition;
    }
    if (originalWebkitSpeechRecognition === undefined) {
      delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;
    } else {
      (globalThis as Record<string, unknown>).webkitSpeechRecognition =
        originalWebkitSpeechRecognition;
    }
  });

  it("restarts recognition after unexpected end until explicitly stopped", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();

    expect(
      startStt({
        onTranscript: vi.fn(),
        onStart,
        onEnd,
      }),
    ).toBe(true);
    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(isSttActive()).toBe(true);

    MockSpeechRecognition.instances[0]?.dispatchEvent(new Event("end"));
    expect(onEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(MockSpeechRecognition.instances).toHaveLength(2);
    expect(MockSpeechRecognition.instances[1]?.start).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(isSttActive()).toBe(true);

    stopStt();

    expect(MockSpeechRecognition.instances[1]?.stop).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(isSttActive()).toBe(false);
  });

  it("stops permanently on fatal permission errors", async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();

    expect(
      startStt({
        onTranscript: vi.fn(),
        onError,
        onEnd,
      }),
    ).toBe(true);
    expect(MockSpeechRecognition.instances).toHaveLength(1);

    emitSpeechError(MockSpeechRecognition.instances[0], "not-allowed");
    MockSpeechRecognition.instances[0]?.dispatchEvent(new Event("end"));
    await vi.advanceTimersByTimeAsync(250);

    expect(onError).toHaveBeenCalledWith("not-allowed");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(MockSpeechRecognition.instances).toHaveLength(1);
    expect(isSttActive()).toBe(false);
  });
});
