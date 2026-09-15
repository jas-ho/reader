# Content and configuration

A list is UTF-8 JSON. Run `node validate.mjs path/to/list.json` from the reader checkout before publishing. Errors name their location, such as `list.sections[0].items[1].title`. Unknown fields are rejected to catch typos. To add a field, follow [the extension recipe](extending.md).

Text fields contain plain Unicode text. Use `\n\n` inside a string for paragraph breaks, which appear on screen and in exports. HTML and Markdown display as text. Put URLs in labeled link objects so they appear as links in both the page and export. Links are optional, including for physical books and private reading assignments.

## Objects

Required properties have no default. Optional arrays default to empty; omitting them and writing `[]` have the same meaning. Optional text is omitted from the page when absent, except the built-in recall and note prompts.

| Object   | Required                                      | Optional / default                                                                                 |
| -------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| List     | `schemaVersion: 1`, `id`, `title`, `sections` | `description`, `recallPrompt`, `notePrompt`, `footer`; prompts use built-in defaults               |
| Section  | `id`, `title`, `items`                        | `description`                                                                                      |
| Item     | `id`, `title`                                 | `byline`, `description`, `why`, `effort: []`, `links: []`, `audio: []`, `parts: []`, `quizzes: []` |
| Part     | `id`, `title`                                 | `description`, `links: []`, `audio: []`                                                            |
| Link     | `label`, `url`                                | None                                                                                               |
| Audio    | `label`, `url`, `description`                 | `src` (direct HTTPS audio URL)                                                                     |
| Quiz     | `id`, `title`, `questions`                    | None                                                                                               |
| Question | `id`, `prompt`, `choices`, `answer`           | `explanation`                                                                                      |
| Choice   | `id`, `text`                                  | None                                                                                               |

- A list has at least one section, and each section at least one item. Ordering in arrays controls display order.
- `description` on an item is the reading assignment: chapters, sections to skim, questions to consider. `why` is the curator's rationale. `byline` can combine author and publication date as appropriate. `effort` is an array of short strings such as `["chapters 1–3", "about 45 minutes"]`.
- Links have descriptive labels and absolute HTTP/HTTPS URLs. The first item link is the main source; companions and alternatives follow. A part's links belong to that part. Avoid a vague label such as “here” when the link will also appear in an export.
- Parts are individually checkable portions of a reading. They have progress, while recall, notes and quizzes belong to the parent item.
- An item can have zero, one or several quizzes. Each quiz has at least one question. Each question has 2–26 choices; `answer` is the correct choice's ID, not its position. Only single-choice questions are supported.
- Quizzes ask for recall first and provide a skip button. Code exercises can be linked but are not executed or graded.

### Audio versions

Add `audio` to an item or a part. Each entry names the provider in `label`, links to the publisher or episode page in `url`, and describes the recording in `description`. Include its language, duration when known, whether the voice is human or synthetic, and whether it reads the assigned text, an excerpt, an older version, or a summary/discussion.

```json
{
  "audio": [
    {
      "label": "Publisher narration",
      "url": "https://example.org/guide/audio",
      "description": "English, 12 minutes. The author reads the complete guide.",
      "src": "https://example.org/guide.mp3"
    }
  ]
}
```

These are placeholder URLs. Replace them with a verified recording. `src` is optional: omit it for a listening option that requires the publisher's player or login. With `src`, the reader shows a play button and loads a native audio player on activation. The source page remains linked if playback fails. Audio requests go directly to the host after activation; recordings are not copied into the deployment. Starting another recording pauses the previous one. Listening does not automatically mark a reading done or save playback position.

Use a public media URL from the publisher's page or podcast feed. Do not use expiring download URLs, gated media files, or arbitrary embed HTML. Check playback and sample the voice before recommending its quality. Compare the spoken coverage with the assigned text; a matching title alone is insufficient. Prefer full readings and explicitly label summaries, discussions and version differences. Recheck availability when updating the list.

Exports include audio source pages and descriptions, so coverage limits travel with the context. Direct media URLs are only used by the player. Adding an audio option preserves reading IDs and saved notes.

### IDs

Use lowercase slugs beginning with a lowercase letter or digit, followed by lowercase letters, digits or hyphens (at most 64 characters). Examples: `week-one`, `chapter-2`, `compare-arguments`. Reserved object keys such as `constructor` and `prototype` are not allowed.

| ID            | Must be unique within                                           |
| ------------- | --------------------------------------------------------------- |
| List          | Your lists on the same origin; choose a new ID for a new domain |
| Section       | The list                                                        |
| Item and part | The entire list, across both types                              |
| Quiz          | The entire list                                                 |
| Question      | Its quiz                                                        |
| Choice        | Its question                                                    |

Quiz answers use the key `<quiz-id>/<question-id>` and a choice ID value.

## Editing a list with saved progress

- Reword a title, move an item, or reorder questions/choices: retain IDs. Notes and answers remain attached to their original identities.
- Replace a reading or question with meaningfully different content: use a new ID. Otherwise old progress or an old answer can be interpreted as applying to the replacement.
- Correct an answer key without changing what the choices mean: retain choice IDs; the score reflects the current answer key. If a choice's meaning changes, give it a new ID. An unsupported saved choice is not displayed as a valid current answer.
- Remove an item: its state remains stored, so restoring the same item ID can restore its notes. Current-list Markdown exports omit removed items and are not full state backups.
- Rename a list ID: this selects different browser storage without migrating existing state. Use `storageKey` to retain a previous storage key during a migration.

Keep generated IDs on subsequent edits. Review ID changes before publishing.

## Configuration

`config.json` is independent of the reading list. Only `content` is required.

| Property          | Meaning / default                                                             |
| ----------------- | ----------------------------------------------------------------------------- |
| `language`        | `en` (default) or `de`; interface, HTML language and Markdown export          |
| `content`         | Relative path to the list JSON                                                |
| `theme`           | Optional relative CSS file, loaded after the default theme                    |
| `storageKey`      | Optional explicit browser storage key; normally `reader:<list-id>`            |
| `compatibility`   | Optional relative JSON file for legacy quiz identities; omitted for new lists |
| `sync`            | Omitted or `null` disables sync entirely                                      |
| `sync.script`     | URL/path of a separately hosted compatible sync browser client                |
| `sync.site`       | Distinct safe ID for this list's sync namespace                               |
| `sync.importFrom` | Optional earlier sync namespace for a deliberate migration                    |

Content, theme and compatibility paths must stay inside the instance: no absolute paths, parent traversal or symlinks. Use `/` separators and simple filenames; a leading `./` is allowed. The assembler refuses names colliding with core files, including `theme.css`; call an instance override `custom-theme.css`. It copies precisely these referenced files, not other files next to them. A sync script is externally hosted and is not bundled by the assembler. CSS overrides should be self-contained; images/fonts referenced from CSS are not automatically copied.

When copying an instance, give the list a new ID and remove or change any `storageKey` override. If sync is enabled, choose a new sync `site`. Keep credentials out of public configuration.

### Legacy compatibility

New lists do not need this. A migration can map stable quiz keys to historical numeric answer slots:

```json
{
  "sample-quiz/sample-question": {
    "key": "qz0v2_0",
    "choices": ["first-choice", "second-choice"]
  }
}
```

`choices` records the historical order. Never reorder or remove its IDs: their positions identify old numeric answers. Append new choices even if they appear elsewhere on screen. The codec converts numeric answers to choice IDs when reading state and converts them back when saving or syncing. Keep this mapping in the instance folder. Validate it and test historical local and remote state before deploying a migration.
