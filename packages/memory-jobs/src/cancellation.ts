export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export class CancellationToken {
  #cancelled = false;
  #reason = "cancelled";

  constructor(signal?: AbortSignal) {
    if (signal?.aborted) {
      this.cancel(typeof signal.reason === "string" ? signal.reason : "aborted");
      return;
    }
    signal?.addEventListener("abort", () => {
      this.cancel(typeof signal.reason === "string" ? signal.reason : "aborted");
    });
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  get reason(): string {
    return this.#reason;
  }

  cancel(reason = "cancelled"): void {
    if (this.#cancelled) {
      return;
    }
    this.#cancelled = true;
    this.#reason = reason;
  }

  throwIfCancelled(): void {
    if (this.#cancelled) {
      throw new CancelledError(this.#reason);
    }
  }
}
