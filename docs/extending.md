# Extend the reader

Most new domains only change content. When a domain needs a new capability, ordinary JavaScript and CSS are the extension surface. There is no plugin registry or hidden build pipeline. Keep authored content separate from personal state.

## Change the theme

`styles.css` controls layout and components. `theme.css` defines the default CSS custom properties, including colors and fonts. In your instance, create `custom-theme.css` and set `"theme":"custom-theme.css"` in `config.json`. It loads after the defaults. The [course override](../examples/course/theme.css) is a small working example.

Override actual properties from `theme.css`. Provide dark-mode equivalents for colors: use both `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` and the explicit `:root[data-theme="dark"]` selector. Keep fonts local/system unless you deliberately add a dependency. The assembler does not collect assets referenced from CSS.

Preview long titles and notes at a narrow phone width as well as desktop. Check keyboard focus, link/button contrast, correct/incorrect quiz feedback and both color themes. For a new layout, edit component styles in `styles.css` rather than trying to express structure through dozens of configuration options.

The default follows the system color preference. The `data-theme` selectors are hooks for an explicit theme toggle you may add; the reader does not currently set that attribute.

## Add an authored field: evidence type

Suppose a research list needs an optional label indicating whether a reading is an experiment, review or argument. Add a simple text field first. Avoid an extensibility system for a single field.

1. In your instance's item, add `"evidenceType":"Literature review"`.
2. In `content.js`, find the item validator inside `validateList`. Add `evidenceType` to its allowed field list and optional string validation. It must remain optional so existing lists still load. Unknown-field rejection should stay enabled for other properties.
3. In `render.js`, find `renderItem`. Add a paragraph or badge when `item.evidenceType` is present. Use `textContent` or the existing DOM helper, never assign authored text to `innerHTML`.
4. In `export.js`, find `itemBlock`. Add the same field to curator context, for example `Evidence type (curator): Literature review`. Exporting directly from data means a layout change cannot silently remove this information.
5. Extend the relevant validation/export tests in `tests/` with a valid string, a wrong type and an omitted field. Include text containing `<` and `&` in a browser fixture to confirm it stays text. Run `npm test`, validate a list, and preview/export it.
6. Document the field in the model reference and add one synthetic example. Keep real curricula in the separate instance folder.

Those changes are intentionally visible: validation defines the contract, rendering defines presentation, and export defines what another chatbot receives. A display-only field needs no personal-state migration. Introducing a required field or changing existing field meaning requires an explicit schema-version and migration decision; additive optional fields do not automatically imply a new version.

## Add functionality

For example, a “revisit later” action needs more thought than a new button:

- Define whether it is authored metadata or a reader's private choice. Reader choices belong in `state.js`, not the content file.
- Read the existing interactions in `reader.js` and their rendering in `render.js`. Extend a named function rather than adding a parallel initialization path.
- Decide how it interacts with done/dropped progress and next-item navigation.
- Define persistence defaults, behavior when older saved state lacks the field, and whether older versions can preserve it.
- If sync is enabled, update its flatten/unflatten boundary deliberately and test resets/deletions as well as saving. Local-only tabs use last-write-wins snapshots; adding a button does not provide concurrent merge semantics.
- Decide whether and how the choice belongs in `export.js`. Do not silently expose private state outside the reader.
- Test keyboard/touch interaction, a reload, existing stored data and exports before publishing.

A new question type similarly needs a clear content contract, rendering, answer validation, storage identity and score/export semantics. Build the actual new type when needed; do not introduce a generic exercise engine in anticipation.

## Keep changes easy to update

Maintain your reader modifications in an ordinary Git fork and your curriculum in a separate folder/repository. Pin the reader commit in the instance's `reader-version`. When adopting upstream changes, inspect the small functions you modified and run your instance's validation and acceptance checks. Pinned assembly requires a clean working tree, including untracked files; ignored temporary files do not count. A commit SHA cannot describe uncommitted edits.

For deployments, package a fresh directory and switch the complete version together. Keep prior release directories for rollback and old tabs. Content IDs should outlive layout changes, and changing a host/origin requires a separate saved-state migration decision.
