(() => {
  if (window.alisioHost?.request || !window.chrome?.webview?.postMessage) {
    return;
  }

  const pending = new Map();

  window.chrome.webview.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.kind !== "alisio-host-response" || typeof message.id !== "string") {
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }

    pending.delete(message.id);

    if (message.ok) {
      entry.resolve(message.result ?? null);
      return;
    }

    const failure = message.error?.message || "Native Windows host request failed";
    entry.reject(new Error(failure));
  });

  window.alisioHost = {
    request(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pending.set(id, { resolve, reject });
        window.chrome.webview.postMessage({
          kind: "alisio-host-request",
          id,
          method,
          params,
        });
      });
    },
  };
})();
