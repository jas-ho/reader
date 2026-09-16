# Reader

Static reading lists with progress tracking, recall, notes and optional quizzes. Readers can copy or download their context for a chatbot. Add [audio versions](docs/model.md#audio-versions) with optional playback in the page. Runs on a static web server.

The examples use fictional book titles and placeholder `example.org` links. Replace them with your own material.

## Try it

Clone or download this repository, open a terminal in its folder, then run:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>. Python 3 is needed for this preview command; any static web server works. Double-clicking `index.html` does not work because browsers restrict loading JSON and JavaScript modules from local files. Stop the server with Ctrl-C.

Edit `examples/book-club/list.json` and refresh. Give a new list a new `id` before entering notes. To try the course example with quizzes, change `config.json` to:

```json
{
  "content": "examples/course/list.json",
  "theme": "examples/course/theme.css"
}
```

See the [field reference](docs/model.md) and [guide to changing themes and functionality](docs/extending.md).

## Validate changes

Node.js 22 or newer is needed for these optional development commands. No `npm install` is necessary.

```sh
node validate.mjs examples/book-club/list.json
npm test
```

Validation reports errors by field path. JSON does not allow comments or trailing commas. Use `\n\n` inside a string for a paragraph break and labeled link records for sources. HTML and Markdown formatting display as text.

### Optional browser checks

The browser acceptance tests require `uv`, Python 3.12 or newer, and Playwright Chromium. Install the browser once, then run the tests:

```sh
uv run --with playwright playwright install chromium
uv run tests/browser.py --screenshots tmp/browser-screenshots
```

`uv` installs the script's Python dependencies. Playwright may need additional system libraries on Linux. Tests use isolated storage and intercepted requests with test data. They cover mobile/desktop layouts, downloads, saved state, error handling and release hosting. The screenshots flag is optional.

## Keep your reading list separate

Keep your content in a separate folder or repository so you can update the application independently. This folder is called an instance:

```text
my-reading-list/
├── config.json
├── list.json
├── custom-theme.css    optional
├── favicon.svg         optional
└── reader-version      optional pinned reader commit
```

Copy the example:

```sh
mkdir ../my-reading-list
cp examples/book-club/list.json ../my-reading-list/list.json
```

Create `../my-reading-list/config.json` containing `{"content":"list.json"}`. Edit the copied title, list ID and readings. Add `"language":"de"` to the config for German controls, messages and Markdown exports; English is the default. Authored reading text stays as written. For a theme override, add `"theme":"custom-theme.css"` to that config and create the CSS file in the instance folder. Paths are relative to this config; use separate names from reader assets such as `theme.css`.

Assemble a new static folder, then preview it. This separate-instance workflow requires Node.js 22 or newer:

```sh
node assemble.mjs --instance ../my-reading-list --out ../reader-preview
python3 -m http.server 8001 --directory ../reader-preview
```

Open <http://localhost:8001>. Output must be a new folder outside both the reader and instance folders, with an existing parent directory. For another preview, choose another output name. Assembly validates and copies the application, favicon, license, config and referenced content/theme/compatibility files. It rejects unsafe paths, symlinks, filenames that conflict with application files, and existing output folders.

Upload the entire assembled folder to a static host, including its subfolders. Hosting under a path such as `/book-club/` works. Reassemble after content, theme or favicon changes.

The default favicon is a cream book on a dark green background. To replace it for one deployment, put a self-contained SVG named `favicon.svg` in the instance folder and reassemble. No config change is needed. The icon is bundled with that release and loads before JavaScript. When serving the reader checkout directly, replace its `favicon.svg` instead.

Publishing this folder makes the reading list and source links public. Keep private notes and credentials out of its content and configuration.

### Pin and update the reader

Record a known reader commit from this checkout:

```sh
git rev-parse HEAD > ../my-reading-list/reader-version
```

`reader-version` holds the full 40-character commit SHA. Assembly requires that commit and a clean working tree, including untracked files; ignored files do not count. Check out the pinned commit and commit or set aside local changes before assembling.

`release.json` records the reader revision. Unpinned previews from modified checkouts are allowed but record `readerRevision: null`, as do downloaded copies and reader folders nested inside another Git repository.

To upgrade, copy your instance, check out a newer reader commit and update the copy's `reader-version`. Validate, assemble and preview it with test notes and progress before publishing. Deploy the complete version together. Keep the previous pin and release files for rollback and tabs still using them.

## Progress and privacy

- Personal progress, recall, notes, scratch text and quiz answers live in this browser's storage, separate from authored content. Clearing browser storage removes them. A new origin, port or browser has separate storage.
- A list ID selects `reader:<list-id>` by default. Reusing an ID on the same origin shares state; changing it starts a separate list.
- Keep item, part, quiz, question and choice IDs when reordering. Use new IDs for unrelated replacements. See [editing rules](docs/model.md#editing-a-list-with-saved-progress).
- Local-only concurrent tabs use last-write-wins snapshots, not automatic merging. Avoid editing notes for the same list in multiple tabs at once.
- If saved data is corrupt or has an unsupported shape, startup stops and leaves it untouched. The error names the entry to recover in your browser's developer tools under Local Storage. Ordinary list/config errors also leave notes untouched.
- **Use in your chatbot** provides source links, reading instructions and your notes as selectable text or a Markdown download. Paste the text into a chatbot or attach the file. The prompt asks it to wait for your question and acknowledge inaccessible sources.
- **Export all notes** covers the current list. Removed items remain in browser storage but are omitted from this export. The Markdown file cannot be imported to restore saved state.

### Optional sync

Sync is off by default and requires a separately hosted compatible service and browser client. Configure it through [these fields](docs/model.md#configuration); the adapter is in `sync.js`. Choose a distinct sync site for each list. Local use continues if sync fails.

## Source map

| File                           | Responsibility                                               |
| ------------------------------ | ------------------------------------------------------------ |
| `locale.js`                    | English/German UI and export wording                         |
| `content.js`                   | Validate content/configuration and find items/links          |
| `render.js`                    | Build the page from content using safe DOM operations        |
| `reader.js`                    | Load files and wire reading interactions                     |
| `state.js`                     | Persistence, quiz identity and optional legacy compatibility |
| `export.js`                    | Build Markdown directly from content and state               |
| `sync.js`                      | Optional adapter to a separately hosted sync client          |
| `styles.css`, `theme.css`      | Layout/components and editable visual defaults               |
| `validate.mjs`, `assemble.mjs` | Check content and package an instance                        |

The code and examples use the [MIT license](LICENSE). Linked readings retain their owners' rights.
