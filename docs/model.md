# Content and configuration

A list is ordinary UTF-8 JSON. Run `node validate.mjs path/to/list.json` from the reader checkout before publishing. Errors name their location, such as `list.sections[0].items[1].title`. Unknown fields are rejected so a misspelled field does not silently disappear. To introduce a new field deliberately, follow [the extension recipe](extending.md).

Text fields contain plain Unicode text. Paragraph breaks are `\n\n` inside a JSON string and are preserved on screen and in context exports. HTML and Markdown are displayed as text, not interpreted. Use labeled link objects rather than embedding URLs in prose; the reader can then render and export them consistently. Items without links are valid, including physical books and private reading assignments.

## Objects

Required properties have no default. Optional arrays default to empty; omitting them and writing `[]` have the same meaning. Optional text is omitted from the page when absent, except the built-in recall and note prompts.

| Object   | Required                                      | Optional / default                                                                    |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| List     | `schemaVersion: 1`, `id`, `title`, `sections` | `description`, `recallPrompt`, `notePrompt`, `footer`; prompts use built-in defaults  |
| Section  | `id`, `title`, `items`                        | `description`                                                                         |
| Item     | `id`, `title`                                 | `byline`, `description`, `why`, `effort: []`, `links: []`, `parts: []`, `quizzes: []` |
| Part     | `id`, `title`                                 | `description`, `links: []`                                                            |
| Link     | `label`, `url`                                | None                                                                                  |
| Quiz     | `id`, `title`, `questions`                    | None                                                                                  |
| Question | `id`, `prompt`, `choices`, `answer`           | `explanation`                                                                         |
| Choice   | `id`, `text`                                  | None                                                                                  |

- A list has at least one section, and each section at least one item. Ordering in arrays controls display order.
- `description` on an item is the reading assignment: chapters, sections to skim, questions to consider. `why` is the curator's rationale. `byline` can combine author and publication date as appropriate. `effort` is an array of short strings such as `["chapters 1–3", "about 45 minutes"]`.
- Links have descriptive labels and absolute HTTP/HTTPS URLs. The first item link is the main source; companions and alternatives follow. A part's links belong to that part. Avoid a vague label such as “here” when the link will also appear in an export.
- Parts are individually checkable portions of a reading. They have progress, while recall, notes and quizzes belong to the parent item.
- An item can have zero, one or several quizzes. Each quiz has at least one question. Each question has 2–26 choices; `answer` is the correct choice's ID, not its position. Only single-choice questions are supported.
- Quizzes ask for recall first but provide a skip button. This gate is fixed behavior, not a configurable assessment engine. Code exercises can be linked but are not executed or graded.

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

IDs identify saved state, rather than display positions or titles. Quiz answers use the key `<quiz-id>/<question-id>` and a choice ID value.

## Editing a list with saved progress

- Reword a title, move an item, or reorder questions/choices: retain IDs. Notes and answers remain attached to their original identities.
- Replace a reading or question with meaningfully different content: use a new ID. Otherwise old progress or an old answer can be interpreted as applying to the replacement.
- Correct an answer key without changing what the choices mean: retain choice IDs; the score reflects the current answer key. If a choice's meaning changes, give it a new ID. An unsupported saved choice is not displayed as a valid current answer.
- Remove an item: its state remains stored, so restoring the same item ID can restore its notes. Current-list Markdown exports omit removed items and are not full state backups.
- Rename a list ID: this selects different browser storage. It does not migrate existing state. An advanced `storageKey` override exists for deliberate compatibility, not routine list creation.

Do not regenerate IDs every time you generate content. Review IDs alongside text changes before publishing. Core content evolution and saved-state compatibility are separate concerns.

## Configuration

`config.json` is independent of the reading list. Only `content` is required.

| Property          | Meaning / default                                                             |
| ----------------- | ----------------------------------------------------------------------------- |
| `content`         | Relative path to the list JSON                                                |
| `theme`           | Optional relative CSS file, loaded after the default theme                    |
| `storageKey`      | Optional explicit browser storage key; normally `reader:<list-id>`            |
| `compatibility`   | Optional relative JSON file for legacy quiz identities; omitted for new lists |
| `sync`            | Omitted or `null` disables sync entirely                                      |
| `sync.script`     | URL/path of a separately hosted compatible sync browser client                |
| `sync.site`       | Distinct safe ID for this list's sync namespace                               |
| `sync.importFrom` | Optional earlier sync namespace for a deliberate migration                    |

Content, theme and compatibility paths must stay inside the instance: no absolute paths, parent traversal or symlinks. Use `/` separators and simple filenames; a leading `./` is allowed. The assembler refuses names colliding with core files, including `theme.css`; call an instance override `custom-theme.css`. It copies precisely these referenced files, not other files next to them. A sync script is externally hosted and is not bundled by the assembler. CSS overrides should be self-contained; images/fonts referenced from CSS are not automatically copied.

Sync is a separately installed integration. Its local-storage key and remote `site` are separate identities: both must be considered when reusing an instance. Never reuse someone else's production settings. Public configuration must not contain secrets.

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

`choices` records historical order independently of current display order. Treat it as append-only: never reorder or remove recorded IDs, because their positions identify old numeric answers. If the same question gains a new choice, append its new ID to this mapping even if it appears elsewhere on screen. Existing numeric answers decode to choice IDs and encode back at the storage/sync boundary. Keep the mapping with the instance that needs it, rather than putting domain-specific migration data into the reusable reader. Validate mappings and test historical local and remote state before deploying a migration.
