# Notes for coding agents

A static reading-list reader: vanilla JavaScript modules, no build step, no dependencies. Content lives in separate instance folders; this repository is the engine plus two fictional examples.

- **Before changing content:** read [docs/model.md](docs/model.md) (fields), then [docs/writing.md](docs/writing.md) (how to fill them: structure in fields, prose as short notes, verify facts and jumps, check meaning with a second reader).
- **Before changing code or themes:** read [docs/extending.md](docs/extending.md). `styles.css` takes colours, fonts, corners and shadows only from tokens in `theme.css`; `tests/theme.test.mjs` enforces this. Authored text is always rendered as text, never as HTML.
- **Any code change, refactors included:** have the plan and then the diff reviewed by someone other than the author; when an AI model wrote it, by a different model. Update `docs/` and the examples in the same commit, so later agents use new fields consistently.
- **Checks:** `npm test` (Node 22+) for unit and theme tests; `uv run tests/browser.py` for the browser suite (phone and desktop layouts, both languages); `node validate.mjs` on both examples and any list you changed. Run all three before committing a change that users will see.
- **README media:** after visible UI changes, regenerate them with `uv run scripts/demo-media.py`.
- **Scope:** keep anything specific to one deployment (hosts, sync servers, private lists) out of this repository; it belongs in the instance or the hosting setup.
