# Extend the reader

Edit JavaScript for behavior and CSS for appearance. Keep reading-list content in your instance folder.

## Change the theme

`styles.css` controls layout and components. `theme.css` defines the default CSS custom properties, including colors and fonts. In your instance, create `custom-theme.css` and set `"theme":"custom-theme.css"` in `config.json`. It loads after the defaults. The [course override](../examples/course/theme.css) is a small working example.

Override properties from `theme.css`. Include dark-mode colors using both `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`. The assembler does not copy images or fonts referenced from CSS; use system fonts or host these assets separately.

Preview long titles and notes at phone and desktop widths. Check keyboard focus, contrast and quiz feedback in both color themes. Edit `styles.css` to change the layout.

The reader follows the system color preference. The `data-theme` selectors support a toggle if you add one; the reader does not set that attribute itself.

## Add an authored field: evidence type

To label readings as experiments, reviews or arguments:

1. In your instance's item, add `"evidenceType":"Literature review"`.
2. In `content.js`, find the item validator inside `validateList`. Add `evidenceType` to its allowed field list and optional string validation. It must remain optional so existing lists still load. Unknown-field rejection should stay enabled for other properties.
3. In `render.js`, find `renderItem`. Add a paragraph or badge when `item.evidenceType` is present. Use `textContent` or the existing DOM helper to display it safely.
4. In `export.js`, find `itemBlock`. Include the field in the exported context, for example `Evidence type (curator): Literature review`.
5. Extend the relevant validation/export tests in `tests/` with a valid string, a wrong type and an omitted field. Include text containing `<` and `&` in a browser fixture to confirm it stays text. Run `npm test`, validate a list, and preview/export it.
6. Document the field in the model reference and add it to an example.

A display-only field needs no saved-state migration. Adding a required field or changing an existing field's meaning requires a schema-version and migration decision. An optional field can keep the current version.

## Add functionality

For a “revisit later” action:

- Store the reader's choice in `state.js`.
- Add the control in `render.js` and its event handler in `reader.js`.
- Decide how it interacts with done/dropped progress and next-item navigation.
- Define persistence defaults, behavior when older saved state lacks the field, and whether older versions can preserve it.
- If sync is enabled, update `flatten` and `unflatten` in `state.js`. Test saving, resets and deletions. Local-only tabs use last-write-wins snapshots; test concurrent edits if the feature needs merging.
- Decide whether to include the choice in `export.js`.
- Test keyboard/touch interaction, a reload, existing stored data and exports before publishing.

A new question type needs content validation, rendering, answer IDs, scoring and export handling.

## Keep changes easy to update

Keep application changes in a Git fork and the reading list in its own folder or repository. After merging upstream changes, review your modified functions and run the tests. Use the README's [pin and upgrade workflow](../README.md#pin-and-update-the-reader) to test and deploy the new version.

Keep content IDs when changing the layout. Moving to another origin requires a separate saved-state migration.
