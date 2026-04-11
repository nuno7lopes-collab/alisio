# MiniMax (Alisio plugin)

Bundled MiniMax plugin for both:

- API-key provider setup (`minimax`)
- Token Plan OAuth setup (`minimax-portal`)

## Enable

```bash
alisio plugins enable minimax
```

Restart the Gateway after enabling.

```bash
alisio gateway restart
```

## Authenticate

OAuth:

```bash
alisio models auth login --provider minimax-portal --set-default
```

API key:

```bash
alisio setup --wizard --auth-choice minimax-global-api
```

## Notes

- MiniMax OAuth uses a user-code login flow.
- OAuth currently targets the Token Plan path.
