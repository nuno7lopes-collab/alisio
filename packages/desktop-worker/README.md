# Desktop Worker

Worker local privado da app desktop v1.

Funções desta fase:

- sessão local mockada;
- storage local em `~/.lume-desktop/`;
- bridge HTTP em loopback;
- chat com modelo real via OpenAI API key local;
- alias seguro `system.whoami`.

Execução em desenvolvimento:

```bash
pnpm desktop:worker
```
