# Reader

A small static reading companion you can understand and adapt. Put your reading list in JSON; readers can track progress, write recall and notes, answer optional quizzes, and take their context to another chatbot. No account, backend, package installation or compilation is required to use the default reader.

The repository contains only synthetic examples. Invented book titles and `example.org` links demonstrate the structure; replace them with your own material.

## Try it

Clone or download this repository, open a terminal in its folder, then run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. Python 3 is needed for this preview command; any static web server works. Double-clicking `index.html` does not work because browsers restrict loading JSON and JavaScript modules from local files. Stop the server with Ctrl-C.

Edit `examples/book-club/list.json`, refresh, and see the change. Give a new reading domain a new list `id` before entering notes. The default example has a book without a source URL, related links, checkable chapters and no quizzes. To try quizzes, change `config.json` to:

```json
{
  "content": "examples/course/list.json",
  "theme": "examples/course/theme.css"
}
```

The [model reference](docs/model.md) explains every field. The [extension guide](docs/extending.md) shows how to change the theme, add metadata or change functionality.

## Validate changes

Node.js 22 or newer is needed for these optional development commands. No `npm install` is necessary.

```sh
node validate.mjs examples/book-club/list.json
npm test
```

Validation exits successfully for a valid list and reports the field path for errors. JSON does not allow comments or trailing commas. Text is plain text: use `\n\n` inside a JSON string for a paragraph break, and explicit labeled link records for sources. HTML and Markdown formatting are not interpreted.

### Optional browser checks

The browser acceptance tests require `uv`, Python 3.12 or newer, and Playwright Chromium. Install the browser once, then run the tests:

```sh
uv run --with playwright playwright install chromium
uv run tests/browser.py --screenshots tmp/browser-screenshots
```

The script declares its Python dependencies, which `uv` installs automatically. Playwright may require additional system libraries on Linux. Tests use isolated browser storage and intercept every request with synthetic fixtures; they exercise desktop/mobile layouts, downloads, state isolation, reordering, invalid content, optional sync failure and immutable release hosting. The screenshots flag is optional.

## Keep your reading list separate

For a real list, keep your content in its own folder or repository. This makes updating the reader independent of editing your curriculum.

```text
my-reading-list/
├── config.json
├── list.json
├── custom-theme.css    optional
└── reader-version      optional pinned reader commit
```

Start by copying the small example:

```sh
mkdir ../my-reading-list
cp examples/book-club/list.json ../my-reading-list/list.json
```

Create `../my-reading-list/config.json` containing `{"content":"list.json"}`. Edit the copied title, list ID and readings. For a theme override, add `"theme":"custom-theme.css"` to that config and create the CSS file in the instance folder. Paths are relative to this config; use separate names from reader assets such as `theme.css`.

Assemble a new static folder, then preview it. This separate-instance workflow requires Node.js 22 or newer:

```sh
node assemble.mjs --instance ../my-reading-list --out ../reader-preview
python3 -m http.server 8001 --directory ../reader-preview
```

Open <http://localhost:8001>. Output must be a **new folder outside both the reader and instance folders**, with an existing parent directory. For another preview, choose another output name. Assembly validates first, then copies only core assets, the MIT license, config and its referenced content/theme/compatibility files. It never copies the whole instance directory. Unsafe paths, symlinks, asset collisions and existing output folders are rejected.

Upload the **entire assembled folder** to a static host, including its subfolders. Hosting under a path such as `/book-club/` works. Assembly packages files; it does not compile them. Content and theme changes require a new assembly before publishing.

Publishing the assembled folder makes its reading list and source links public. Keep private notes and secrets out of your authored content and configuration. Files merely being absent from the public reader repository does not make a published instance private.

### Pin and update the reader

Record a known reader commit from this checkout:

```sh
git rev-parse HEAD > ../my-reading-list/reader-version
```

On another machine, check out that full commit in the reader repository before assembling. `reader-version` is a full 40-character SHA; assembly refuses a different checkout HEAD and records the revision in `release.json` without local paths. Pinned assembly requires a clean reader working tree, including untracked files (ignored temporary files do not count). Commit or set aside local changes first: a commit SHA cannot represent uncommitted edits. Unpinned previews are allowed from modified checkouts, but their `release.json` records `readerRevision: null`; downloaded copies and reader folders nested inside a different Git repository also have no reader revision.

To upgrade, copy your instance to a candidate folder, check out a newer reader commit, and update the candidate's `reader-version` to that commit. Validate the candidate, assemble it into a new directory and preview it with synthetic progress before adopting its pin. Keep the previous instance pin and deployed release for rollback. Review release changes before updating a list with real saved state. Keep old deployed release files available for already-open tabs; switching versions should publish a complete, internally consistent directory rather than overwriting individual modules in place.

## Progress and privacy

- Personal progress, recall, notes, scratch text and quiz answers live in this browser's storage, separate from authored content. Clearing browser storage removes them. A new origin, port or browser has separate storage.
- A list ID selects `reader:<list-id>` by default. Reusing an ID on the same origin shares state; changing it starts a separate list. Keep IDs when rearranging existing material, and change them when creating a new domain.
- Keep item, part, quiz, question and choice IDs stable after use. Reordering is safe; giving an unrelated replacement the same ID reuses the earlier progress or answer. See [editing rules](docs/model.md#editing-a-list-with-saved-progress).
- Local-only concurrent tabs use last-write-wins snapshots, not automatic merging. Avoid editing notes for the same list in multiple tabs at once.
- If saved data is corrupt or has an unsupported shape, startup stops and leaves it untouched. The error names the entry to recover in your browser's developer tools under Local Storage. Ordinary list/config errors also leave notes untouched.
- **Use in your chatbot** prepares selectable text and a Markdown download. It includes source links, curator context and your recorded notes; no article cache or chatbot request is involved. Copy it yourself or attach the file. The receiving chatbot is instructed to wait for your question and acknowledge sources it cannot access.
- **Export all notes** covers the current list. State for removed items remains stored, but those items are omitted from this export. Markdown is a readable handoff, **not a complete or importable state backup**.

### Optional sync

The default makes no sync requests. Cross-device sync needs a separately operated compatible service and browser client; it is not supplied by this repository. `sync.js` is the small integration boundary. See [configuration](docs/model.md#configuration) for the opt-in fields. Local use remains available when sync is unavailable. Choose a distinct sync site for each list, independently of the local storage key. Never put access credentials in public configuration.

## Source map

| File                           | Responsibility                                               |
| ------------------------------ | ------------------------------------------------------------ |
| `content.js`                   | Validate content/configuration and find items/links          |
| `render.js`                    | Build the page from content using safe DOM operations        |
| `reader.js`                    | Load files and wire reading interactions                     |
| `state.js`                     | Persistence, quiz identity and optional legacy compatibility |
| `export.js`                    | Build Markdown directly from content and state               |
| `sync.js`                      | Optional adapter to a separately hosted sync client          |
| `styles.css`, `theme.css`      | Layout/components and editable visual defaults               |
| `validate.mjs`, `assemble.mjs` | Check content and package an instance                        |

The [license](LICENSE) is MIT, including the synthetic examples. Linked source material retains its owners' rights; the code license does not grant rights to outside readings.
