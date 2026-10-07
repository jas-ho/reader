# Write a reading list

The [field reference](model.md) says what each field holds; this guide is about filling them well. It applies whether a person or a language model writes the text.

## What the reader sees

Readers mostly use a phone. Each reading appears in this order:

1. The title, then one line of metadata: priority, byline, time and any `effort` notes ("Essential · Ada Writer, 2024 · ~25 min").
2. `description`: your note on the reading.
3. `why`: your reason for including it, smaller and quieter.
4. "Read: …" from `scope`, directly above the links.
5. The links, each with any `jumps` into it.

Section headers and the masthead show counts and times computed from `minutes`.

## Put structure in fields, not prose

If every description starts the same way, a field is probably doing two jobs. Give each kind of information its own field:

| Information | Field | Not |
| --- | --- | --- |
| What to read | `scope`: `"chapters 1–3"`, `"sections 2.3 and 4.2"`, `"the three passages below"` | "Read chapters 1–3." opening each description |
| How long | `minutes` on the item or each part | "about 45 minutes" in prose; totals in section or list descriptions |
| Where in a source | `jumps` on the link (see [jumps](model.md#jumps-into-a-source)) | a list of quoted lines to search for |
| Must or may | `priority` | "Essential:" in the title or description |
| Other workload notes | `effort`: `["dense legal text", "needs a free login"]` | what to read (that is `scope`) |

The reader computes reading times and the counts and times shown for sections and the list, so do not repeat them in prose: they go stale as soon as a reading is added or a time changes. Numbers from the source itself (a study's sample size, a three-day incident) belong in the prose.

## Write the prose

- **description:** a short note from someone who has read it, usually two to four sentences and fewer for a simple source. Say what the source is and what is interesting or surprising in it, with the specifics that matter: a number, a named section, a short verbatim quote when the wording is the point. Say what to watch for when that helps. Vary how descriptions open across the list. Keep a source caveat when it changes how to read or cite the source: a vendor's own claim, an undated or changing page, a draft, a later event that contradicts it.
- **why:** one or two sentences on why this reading is on the list, naming the concrete fact or mechanism that matters. Do not repeat the description. When the link between the source and your argument is your inference and not the source's claim, say so. Pick one short marker, such as "(our inference)", and use it consistently.
- **scope:** a short fragment that reads naturally after "Read:" ("Lesen:" in German), such as "in full" or "chapters 1–3".
- **Section and list descriptions:** short: who it is for and what it covers, plus the reading order for the list.

Plain words beat impressive ones. Cut sentences that only restate the previous one, closing verdicts ("A demanding read."), and stock phrases.

### Example

Less useful:

> Read chapters 1–3 in your own copy. Note the narrator's description of the garden wall, the shift in perspective in chapter 3, and the unresolved question of who built the wall. This is about 45 minutes of reading.

More useful, with `"scope": "chapters 1–3"` and `"minutes": 45`:

> The narrator describes the garden wall in every chapter but never says who built it. Chapter 3 switches to the neighbour's view of the same wall; mark the passage you would bring to the group.

## Check before publishing

1. **Verify the facts first.** Every claim, quote, number and caveat in the prose should come from the source, checked before you polish the wording. When a model writes the prose, give it only these verified notes and tell it to add nothing.
2. **Have someone else check meaning, claim by claim.** Ideally that is another person or a different model from the writer. Faithfulness errors are subtle: a dropped "only", a hedge moved onto the wrong claim, your inference presented as the source's. Pattern checks do not find them; a reader comparing old and new text does. Send the findings back to the writer rather than patching the text yourself, so the list keeps one voice.
3. **Check every link and jump on a phone.** When a source exists in several forms, put the one that reads best on a phone first: an HTML page with text-fragment jumps usually beats a PDF. A jump's phrase must occur on the page once, near the start of the part you mean; label the jump by what the reader finds there, not by the mechanism; leave printed page numbers out of PDF jump labels, since the reader shows the PDF page. Pages change, and a broken fragment fails silently.
4. **Look at it on a phone.** Read three cards in the assembled page, not in the JSON. Judge tone there.
5. **Validate:** `node validate.mjs path/to/list.json`.
