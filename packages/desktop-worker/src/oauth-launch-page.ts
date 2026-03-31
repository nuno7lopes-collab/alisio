export function renderOpenAICodexLaunchPage(): string {
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lume OAuth</title>
  <style>
    :root {
      color-scheme: light;
      --bg-a: #f3f0ea;
      --bg-b: #f7f3ed;
      --bg-c: #efe8de;
      --surface: rgba(255, 252, 247, 0.92);
      --line: rgba(24, 22, 19, 0.08);
      --ink: #181613;
      --muted: rgba(24, 22, 19, 0.62);
      --accent: #b7562a;
      --ok: #2c6a62;
      --shadow: 0 18px 42px rgba(24, 22, 19, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top left, rgba(183, 86, 42, 0.10), transparent 24%),
        radial-gradient(circle at 88% 16%, rgba(44, 106, 98, 0.10), transparent 22%),
        linear-gradient(135deg, var(--bg-a), var(--bg-b) 52%, var(--bg-c));
      color: var(--ink);
      font-family: "Manrope", "Avenir Next", "Segoe UI", ui-sans-serif, sans-serif;
      padding: 24px;
    }
    .card {
      width: min(560px, 100%);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      box-shadow: var(--shadow);
      display: grid;
      gap: 18px;
    }
    h1, p { margin: 0; }
    h1 {
      font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
      font-size: 32px;
      letter-spacing: -0.04em;
    }
    p { color: var(--muted); line-height: 1.5; }
    .eyebrow {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--accent);
    }
    .status {
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(255, 248, 227, 0.94);
      color: #6b4d14;
      border: 1px solid rgba(192, 138, 43, 0.20);
      word-break: break-word;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 16px;
      padding: 12px 16px;
      background: var(--accent);
      color: white;
      text-decoration: none;
      font-weight: 700;
    }
    .button.secondary {
      background: rgba(255, 255, 255, 0.58);
      color: var(--ink);
      border: 1px solid rgba(24, 22, 19, 0.08);
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main class="card">
    <div>
      <div class="eyebrow">Ligação AI</div>
      <h1>Ligar OpenAI</h1>
      <p>Esta janela prepara a conta AI deste dispositivo e segue para a OpenAI assim que o link estiver pronto.</p>
    </div>
    <div id="status" class="status">A preparar a ligação…</div>
    <div class="actions">
      <a id="open-link" class="button hidden" href="#" target="_self" rel="noreferrer">Abrir login OpenAI</a>
      <a class="button secondary" href="/" target="_self">Voltar ao Lume</a>
    </div>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const openLinkEl = document.getElementById("open-link");
    let redirected = false;

    async function request(path, options) {
      const response = await fetch(path, {
        headers: { "content-type": "application/json" },
        ...options,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(payload.error || text || "Pedido falhou.");
      }
      return payload;
    }

    function showAuthUrl(authUrl) {
      openLinkEl.href = authUrl;
      openLinkEl.classList.remove("hidden");
      statusEl.textContent = "A abrir a OpenAI…";
      if (!redirected) {
        redirected = true;
        window.location.replace(authUrl);
      }
    }

    async function poll() {
      const payload = await request("/auth/openai-codex/status");
      const oauth = payload.oauth || {};
      if (oauth.authUrl) {
        showAuthUrl(oauth.authUrl);
        return;
      }
      if (oauth.error) {
        statusEl.textContent = "Falha ao preparar a ligação. " + oauth.error;
        return;
      }
      statusEl.textContent = oauth.message || "A preparar a ligação…";
      setTimeout(() => {
        poll().catch((error) => {
          statusEl.textContent = String(error);
        });
      }, 600);
    }

    request("/auth/openai-codex/start", {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(() => poll())
      .catch((error) => {
        statusEl.textContent = String(error);
      });
  </script>
</body>
</html>`;
}
