# Alisio docs i18n assets

This folder stores **generated** and **config** files for documentation translations.

## Files

- `glossary.<lang>.json` — preferred term mappings (used in prompt guidance).
- `<lang>.tm.jsonl` — translation memory (cache) keyed by workflow + model + text hash.

## Prerequisites

`scripts/docs-i18n` runs from the Go module in `scripts/docs-i18n/`.
Do not run `go run scripts/docs-i18n/main.go`; it compiles only `main.go` and fails.

By default, `docs-i18n` resolves providers in this order:

- `ALISIO_DOCS_I18N_PROVIDER` override
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `~/.pi/agent/auth.json` entries in this fallback order: `openai-codex`, `anthropic`, `openai`
- fallback provider name `openai` when nothing else is configured

For the default OpenAI/Anthropic/Codex path, make sure one of these auth sources is available:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `~/.pi/agent/auth.json` created via `pi` and `/login`
  - `openai-codex` works for ChatGPT Plus/Pro OAuth
  - `anthropic` works for Claude OAuth/API-key auth

If you explicitly set `ALISIO_DOCS_I18N_PROVIDER` to another Pi provider, satisfy that provider's normal auth requirements separately.

If none of the above exist, `docs-i18n` now fails fast with an actionable error message instead of starting translation work and failing mid-run.

## Running zh-CN Regeneration

Validate glossary coverage first:

```bash
pnpm docs:check-i18n-glossary
```

Full zh-CN regeneration from the repo root:

```bash
cd scripts/docs-i18n
go run . -docs ../../docs -mode doc -parallel 6 \
  $(find ../../docs -type f \( -name '*.md' -o -name '*.mdx' \) ! -path '../../docs/zh-CN/*' ! -path '../../docs/ja-JP/*')
```

Single-file regeneration:

```bash
cd scripts/docs-i18n
go run . -docs ../../docs -mode doc ../../docs/channels/matrix.md
```

Small patch regeneration with translation memory:

```bash
cd scripts/docs-i18n
go run . -docs ../../docs -mode segment ../../docs/channels/matrix.md
```

Notes:

- Doc mode now skips files only when `source_hash`, `workflow`, `provider`, and `model` all still match the current pipeline state.
- When you intentionally change prompt rules or glossary behavior, bump `workflowVersion` in `scripts/docs-i18n/util.go` so doc/segment caches invalidate together.
- Add glossary entries before regeneration for new product names, short page titles, path literals, and other fixed technical terms.

## Verification

After regeneration:

```bash
rg -n "Alisio|alisio|ClawHub|alisio.ai" docs/zh-CN
pnpm check:docs
```

## Glossary format

`glossary.<lang>.json` is an array of entries:

```json
{
  "source": "troubleshooting",
  "target": "故障排除",
  "ignore_case": true,
  "whole_word": false
}
```

Fields:

- `source`: English (or source) phrase to prefer.
- `target`: preferred translation output.

## Notes

- Glossary entries are passed to the model as **prompt guidance** (no deterministic rewrites).
- The translation memory is updated by `scripts/docs-i18n`.
