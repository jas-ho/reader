#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright"]
# ///
"""Synthetic browser acceptance: uv run tests/browser.py [--screenshots PATH].

Requires Playwright Chromium (`uv run --with playwright playwright install chromium`).
All requests are intercepted. No production content, account or network is used.
"""

import argparse
import copy
import io
import mimetypes
import wave
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://reader.test"
PREFIX = "/nested/reader/"
NOTE = "PRIVATE synthetic note 🐛\n<script>window.noteExecuted = true</script>"
RECALL = "PRIVATE synthetic recall\nA second line."
HOSTILE = '<img src="bad" onerror="window.authoredExecuted=true">'


def course():
    return {
        "schemaVersion": 1,
        "id": "example-course",
        "title": "A synthetic course",
        "description": "An invented course for testing.\nNo enrollment needed.",
        "sections": [
            {
                "id": "week-one",
                "title": "Week one",
                "items": [
                    {
                        "id": "first-reading",
                        "title": "An opening argument",
                        "byline": "An example author",
                        "description": "Read paragraphs 1–3.\nCompare two explanations.\n"
                        + HOSTILE,
                        "why": "Practice finding an assumption.",
                        "effort": ["10 minutes", "Discussion optional"],
                        "links": [
                            {
                                "label": "Original reading",
                                "url": "https://example.org/reading",
                            }
                        ],
                        "parts": [
                            {
                                "id": "first-exercise",
                                "title": "Try a counterexample",
                                "description": "Write one example.\nCheck its assumptions.",
                                "links": [
                                    {
                                        "label": "Exercise",
                                        "url": "https://example.org/exercise",
                                    }
                                ],
                            }
                        ],
                        "quizzes": [
                            {
                                "id": "argument-check",
                                "title": "Check the argument",
                                "questions": [
                                    {
                                        "id": "assumption",
                                        "prompt": "Which assumption is needed?",
                                        "choices": [
                                            {"id": "finite", "text": "A finite set"},
                                            {
                                                "id": "infinite",
                                                "text": "An infinite set",
                                            },
                                        ],
                                        "answer": "finite",
                                        "explanation": "The argument uses a finite set.",
                                    },
                                    {
                                        "id": "example",
                                        "prompt": "Which example is simplest?",
                                        "choices": [
                                            {"id": "empty", "text": "The empty set"},
                                            {"id": "pair", "text": "A pair"},
                                        ],
                                        "answer": "empty",
                                    },
                                ],
                            }
                        ],
                    },
                    {"id": "second-reading", "title": "A later discussion"},
                ],
            }
        ],
    }


def book_club():
    return {
        "schemaVersion": 1,
        "id": "example-book-club",
        "title": "A synthetic book club",
        "sections": [
            {
                "id": "meeting",
                "title": "First meeting",
                "items": [
                    {
                        "id": "first-reading",
                        "title": "Bring a physical book",
                        "description": "Read chapter one.",
                    }
                ],
            }
        ],
    }


class Site:
    """Serve the exact engine with swappable synthetic instance data."""

    def __init__(self, page, data, prefix=PREFIX, root_entry=False):
        self.page = page
        self.data = data
        self.prefix = prefix
        self.root_entry = root_entry
        self.config = {"content": "content/list.json"}
        self.requests = []
        self.errors = []
        self.unexpected = []
        self.media = {}
        self.sync_script = None
        self.hold_config = False
        self.pending_config = None
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.route("**/*", self.route)

    def route(self, route):
        url = urlparse(route.request.url)
        self.requests.append(route.request.url)
        if route.request.url in self.media:
            body = self.media[route.request.url]
            route.fulfill(
                status=200 if body else 404, body=body or b"", content_type="audio/wav"
            )
            return
        if (
            self.root_entry
            and url.scheme + "://" + url.netloc == ORIGIN
            and url.path == "/"
        ):
            html = (ROOT / "index.html").read_text()
            html = html.replace('href="./', f'href="{self.prefix}').replace(
                'src="./', f'src="{self.prefix}'
            )
            route.fulfill(body=html, content_type="text/html")
            return
        if url.scheme + "://" + url.netloc != ORIGIN or not url.path.startswith(
            self.prefix
        ):
            self.unexpected.append(route.request.url)
            route.abort()
            return
        relative = url.path[len(self.prefix) :] or "index.html"
        if relative == "config.json":
            if self.hold_config:
                self.pending_config = route
            else:
                route.fulfill(json=self.config)
        elif relative == "content/list.json":
            route.fulfill(json=self.data)
        elif relative == "test-sync.js" and self.sync_script is not None:
            route.fulfill(body=self.sync_script, content_type="text/javascript")
        elif relative in {
            "index.html",
            "reader.js",
            "content.js",
            "render.js",
            "state.js",
            "export.js",
            "sync.js",
            "locale.js",
            "styles.css",
            "theme.css",
        }:
            content_type = (
                "text/javascript"
                if relative.endswith(".js")
                else mimetypes.guess_type(relative)[0]
            )
            route.fulfill(path=str(ROOT / relative), content_type=content_type)
        else:
            self.unexpected.append(route.request.url)
            route.abort()

    def open(self):
        self.page.goto(ORIGIN + ("/" if self.root_entry else self.prefix))

    def healthy(self):
        assert not self.errors, self.errors
        assert not self.unexpected, self.unexpected
        assert not any(
            "/sync/" in url or "/chat/" in url or "/sources/" in url
            for url in self.requests
        )
        assert not any("PRIVATE" in url for url in self.requests)


def storage(page):
    return page.evaluate("Object.fromEntries(Object.entries(localStorage))")


def check_layout(page, width):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
        f"overflow at {width}px"
    )


def download_text(page):
    with page.expect_download() as info:
        page.locator("#notesDownload").click()
    download = info.value
    assert download.suggested_filename.endswith(".md")
    return Path(download.path()).read_text()


def interactions(browser, width, screenshots):
    context = browser.new_context(
        viewport={"width": width, "height": 900 if width > 600 else 844},
        is_mobile=width <= 600,
        has_touch=width <= 600,
    )
    page = context.new_page()
    site = Site(page, course())
    site.open()
    expect(page.locator(".item")).to_have_count(2)
    card = page.locator('.item[data-id="first-reading"]')
    expect(card).to_contain_text(HOSTILE)
    assert (
        card.locator("h3").evaluate("node => getComputedStyle(node).textDecorationLine")
        == "none"
    )
    assert not page.evaluate("Boolean(window.authoredExecuted || window.noteExecuted)")
    expect(card.locator("img")).to_have_count(0)
    check_layout(page, width)

    # A real button supports keyboard operation and stable part IDs.
    part = card.locator(".subs li button").first
    part.focus()
    page.keyboard.press("Space")
    assert page.evaluate("window.readerPage.get().items['first-exercise']") == "done"

    card.locator(".closeout > summary").click()
    card.locator("textarea.recall").fill(RECALL)
    card.locator("textarea.notetext").fill(NOTE)
    # The first answer remains focusable after selecting it; status is explicit.
    card.locator(".quiz > summary").click()
    finite = card.locator(".opt").filter(has_text="A finite set").first
    finite.focus()
    page.keyboard.press("Enter")
    expect(finite).to_be_focused()
    expect(finite).to_have_attribute("aria-disabled", "true")
    expect(card.locator(".quiz")).to_contain_text("Correct")
    assert (
        page.evaluate("window.readerPage.get().quiz['argument-check/assumption']")
        == "finite"
    )

    card.locator(".copy1").click()
    expect(page.locator("#handoff")).to_be_visible()
    text = page.locator("#handoffText").input_value()
    for required in [
        "https://example.org/reading",
        "https://example.org/exercise",
        "Original reading",
        "Exercise",
        "Read paragraphs 1–3.",
        "Compare two explanations.",
        "10 minutes",
        "Try a counterexample",
        "Write one example.",
        "Check its assumptions.",
        HOSTILE,
        NOTE.replace("\n", "\n> "),
        RECALL.replace("\n", "\n> "),
    ]:
        assert required in text, required
    assert "Wait for my question" in text
    assert "A later discussion" not in text
    assert download_text(page) == text
    check_layout(page, width)
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
        for mode in ("light", "dark"):
            page.emulate_media(color_scheme=mode)
            check_layout(page, width)
            page.screenshot(
                path=str(screenshots / f"handoff-{width}-{mode}.png"),
                animations="disabled",
            )
    page.keyboard.press("Escape")
    expect(card.locator(".copy1")).to_be_focused()

    page.locator("#freeform").fill("PRIVATE synthetic scratch")
    # On phones the fixed bar deliberately yields space to the text keyboard.
    page.locator("h1").click()
    page.locator("#exportBtn").click()
    all_text = page.locator("#handoffText").input_value()
    assert "PRIVATE synthetic scratch" in all_text and "A later discussion" in all_text
    assert download_text(page) == all_text
    page.locator("#handoffClose").click()

    # Moving display positions must not change identity or answer meaning.
    saved = storage(page)
    original = copy.deepcopy(site.data)
    items = site.data["sections"][0]["items"]
    quiz = items[0]["quizzes"][0]
    quiz["questions"][0]["choices"].reverse()
    quiz["questions"].reverse()
    items.reverse()
    page.reload()
    page.wait_for_function("Boolean(window.readerPage)")
    expect(page.locator(".item").first).to_have_attribute("data-id", "second-reading")
    assert storage(page) == saved
    assert (
        page.evaluate("window.readerPage.get().quiz['argument-check/assumption']")
        == "finite"
    )
    expect(card.locator("textarea.notetext")).to_have_value(NOTE)
    card.locator(".closeout > summary").click()
    card.locator(".quiz > summary").click()
    expect(card.locator(".opt").filter(has_text="A finite set")).to_have_attribute(
        "aria-disabled", "true"
    )
    card.get_by_role("button", name="Reset this quiz", exact=True).click()
    assert page.evaluate(
        "window.readerPage.get().quiz['argument-check/assumption'] === undefined"
    )
    page.reload()
    page.wait_for_function("Boolean(window.readerPage)")
    assert page.evaluate(
        "window.readerPage.get().quiz['argument-check/assumption'] === undefined"
    )

    # A second domain works without a code edit, even reusing item IDs.
    site.data = book_club()
    page.reload()
    page.wait_for_function("Boolean(window.readerPage)")
    expect(page.locator(".item")).to_have_count(1)
    expect(page.locator(".quiz")).to_have_count(0)
    assert page.evaluate("window.readerPage.get().notes['first-reading'] === undefined")
    card.locator(".closeout > summary").click()
    card.locator("textarea.notetext").fill("A separate book-club note")
    card.locator(".copy1").click()
    assert "No source link" in page.locator("#handoffText").input_value()
    assert "PRIVATE synthetic" not in page.locator("#handoffText").input_value()
    page.locator("#handoffClose").click()
    site.data = original
    page.reload()
    page.wait_for_function("Boolean(window.readerPage)")
    expect(card.locator("textarea.notetext")).to_have_value(NOTE)
    keys = storage(page)
    assert "reader:example-course" in keys and "reader:example-book-club" in keys
    assert not page.evaluate("Boolean(window.authoredExecuted || window.noteExecuted)")
    site.healthy()
    context.close()


def startup_errors(browser):
    for mode in ("config", "content"):
        context = browser.new_context()
        page = context.new_page()
        site = Site(page, course())
        site.hold_config = True
        if mode == "config":
            site.config["content"] = "../outside.json"
        else:
            site.data["sections"][0]["items"][0]["unexpectedField"] = "Typo"
        page.goto(ORIGIN + PREFIX, wait_until="domcontentloaded")
        expect(page.locator("#startup-error")).to_have_attribute("role", "status")
        assert site.pending_config is not None
        site.pending_config.fulfill(json=site.config)
        expect(page.locator("#startup-error")).to_be_visible()
        expect(page.locator("#startup-error")).to_have_attribute("role", "alert")
        expect(page.locator("#startup-error")).to_contain_text(
            "config.content" if mode == "config" else "unexpectedField"
        )
        assert storage(page) == {}, (
            "invalid authored data must not create or overwrite personal state"
        )
        site.healthy()
        context.close()


def incompatible_sync_stays_local(browser):
    for build in (None, 1):
        context = browser.new_context()
        page = context.new_page()
        site = Site(page, book_club())
        site.config["sync"] = {"script": "test-sync.js", "site": "synthetic-reader"}
        build_field = "" if build is None else f"build: {build},"
        site.sync_script = (
            "window.jashoSync = {"
            + build_field
            + "attach() { window.incompatibleAttached = true; }};"
        )
        site.open()
        expect(page.locator(".item")).to_have_count(1)
        expect(page.locator("#sync-status")).to_contain_text("build 2")
        assert not page.evaluate("Boolean(window.incompatibleAttached)")
        card = page.locator(".item")
        card.locator(".closeout > summary").click()
        card.locator("textarea.notetext").fill(
            "Still saves locally with incompatible sync"
        )
        card.locator("textarea.notetext").blur()
        assert (
            page.evaluate(
                "JSON.parse(localStorage.getItem('reader:example-book-club')).notes['first-reading']"
            )
            == "Still saves locally with incompatible sync"
        )
        card.locator(".copy1").click()
        text = page.locator("#handoffText").input_value()
        assert "Still saves locally with incompatible sync" in text
        assert download_text(page) == text
        site.healthy()
        context.close()


def immutable_release_root(browser):
    context = browser.new_context()
    page = context.new_page()
    release = "/releases/test-id/"
    site = Site(page, book_club(), prefix=release, root_entry=True)
    site.open()
    expect(page.locator(".item")).to_have_count(1)
    assert page.url == ORIGIN + "/", "the public entry URL must stay unchanged"
    card = page.locator(".item")
    card.locator(".closeout > summary").click()
    card.locator("textarea.notetext").fill("A note through an immutable release")
    card.locator(".copy1").click()
    text = page.locator("#handoffText").input_value()
    assert "A note through an immutable release" in text
    assert "Bring a physical book" in text
    assert download_text(page) == text
    for asset in (
        "reader.js",
        "content.js",
        "styles.css",
        "theme.css",
        "config.json",
        "content/list.json",
    ):
        assert ORIGIN + release + asset in site.requests, asset
    assert all(
        url == ORIGIN + "/" or url.startswith(ORIGIN + release) for url in site.requests
    )
    site.healthy()
    context.close()


def accessibility_regressions(browser):
    context = browser.new_context(reduced_motion="reduce")
    page = context.new_page()
    data = course()
    item = data["sections"][0]["items"][0]
    second_quiz = copy.deepcopy(item["quizzes"][0])
    second_quiz["id"] = "second-check"
    second_quiz["title"] = "Another check"
    item["quizzes"].append(second_quiz)
    site = Site(page, data)
    context.add_init_script(
        "localStorage.setItem('reader:example-course', JSON.stringify({"
        "items:{},notes:{},recall:{},freeform:'',"
        "quiz:{'argument-check/assumption':'finite'}}));"
    )
    site.open()
    expect(page.locator(".quiz")).to_have_count(2)
    card = page.locator('.item[data-id="first-reading"]')
    head = card.locator(".head .box")
    part = card.locator(".subs li button").first
    part.focus()
    page.keyboard.press("Space")
    expect(head).to_be_focused()
    expect(card).to_have_attribute("data-state", "done")
    page.keyboard.press("Space")
    card.locator(".drop").focus()
    page.keyboard.press("Enter")
    expect(head).to_be_focused()
    expect(card).to_have_attribute("data-state", "dropped")
    page.keyboard.press("Space")

    card.locator(".closeout > summary").click()
    first = card.locator(".quiz").nth(0)
    second = card.locator(".quiz").nth(1)
    first.locator("summary").click()
    expect(first.locator(".qbody")).to_be_visible()
    # This answer came from storage. Neither recall nor a skip keeps the body
    # open after reset, so keyboard focus must escape the newly hidden body.
    first.get_by_role("button", name="Reset this quiz", exact=True).click()
    expect(first.locator(".qbody")).to_be_hidden()
    expect(first.locator("summary")).to_be_focused()
    second.locator("summary").click()
    expect(second.locator(".qbody")).to_be_hidden()
    first.get_by_role("button", name="show the quiz without recall", exact=True).click()
    expect(first.locator("summary")).to_be_focused()
    expect(first.locator(".qbody")).to_be_visible()
    expect(second.locator(".qbody")).to_be_visible()
    first.locator('[data-choice="finite"]').first.click()
    expect(first.locator(".rat").first).to_contain_text("Correct")
    page.evaluate("""() => {
        window.statusMutations = [];
        window.statusObserver = new MutationObserver(records => {
            window.statusMutations.push(...records.map(record => record.type));
        });
        for (const node of document.querySelectorAll('.qscore, .rat, #count')) {
            window.statusObserver.observe(node, {childList:true, characterData:true, subtree:true});
        }
    }""")
    card.locator("textarea.notetext").press_sequentially(
        "Typing should not repeat quiz announcements."
    )
    assert page.evaluate("window.statusMutations") == [], (
        "unchanged scores/results must not be announced on each keystroke"
    )
    assert (
        first.locator("summary").evaluate(
            "node => getComputedStyle(node, '::after').transitionDuration"
        )
        == "0s"
    )
    site.healthy()
    context.close()


def german_reader(browser, screenshots):
    context = browser.new_context(
        viewport={"width": 320, "height": 800}, color_scheme="dark"
    )
    page = context.new_page()
    site = Site(page, course())
    site.config["language"] = "de"
    site.config["sync"] = {"script": "test-sync.js", "site": "synthetic-reader"}
    site.sync_script = "window.jashoSync = {build: 2, attach(config) { window.syncLanguage = config.language; }};"
    site.open()
    expect(page.locator("html")).to_have_attribute("lang", "de")
    page.wait_for_function("window.syncLanguage === 'de'")
    expect(page.locator("#count")).to_have_text("2 offen")
    expect(page.get_by_role("button", name="Export aller Notizen")).to_be_visible()
    card = page.locator("article.item").first
    expect(card.locator(".why")).to_have_text("Practice finding an assumption.")
    card.locator(".closeout > summary").click()
    card.locator(".recall").fill("Meine Erinnerung")
    card.locator(".notetext").fill("Eine deutsche Notiz")
    quiz = card.locator(".quiz").first
    quiz.locator("summary").click()
    quiz.locator('[data-choice="finite"]').first.click()
    expect(quiz.locator(".rat").first).to_contain_text("Richtig.")
    expect(quiz.locator(".qscore")).to_have_text("1/1 richtig")
    card.locator(".notetext").blur()
    page.reload()
    expect(card.locator(".notetext")).to_have_value("Eine deutsche Notiz")
    page.locator("#exportBtn").click()
    expect(page.locator("#handoffTitle")).to_have_text("Export aller Notizen")
    text = page.locator("#handoffText").input_value()
    assert "Warte auf meine Frage" in text and "Eine deutsche Notiz" in text
    assert "https://example.org/reading" in text
    assert download_text(page) == text
    page.locator("#handoffClose").click()
    check_layout(page, 320)
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshots / "german-320.png"), full_page=True)
    site.healthy()
    context.close()


def audio_versions(browser, screenshots):
    # Actual browser playback against a generated silent WAV, with no network.
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(8000)
        sound.writeframes(b"\0\0" * 8000 * 30)
    for language, width in (("en", 1280), ("de", 320)):
        context = browser.new_context(
            viewport={"width": width, "height": 844}, color_scheme="dark"
        )
        page = context.new_page()
        data = course()
        item = data["sections"][0]["items"][0]
        item["audio"] = [
            {
                "label": "Publisher reading " + HOSTILE,
                "url": item["links"][0]["url"],
                "description": "English synthetic reading, full text. " + HOSTILE,
                "src": "https://media.example.org/reading.wav",
                "duration": "30 sec",
                "warning": "Transcript differs. " + HOSTILE,
                "details": "An older publication. " + HOSTILE,
            },
            {
                "label": "Podcast discussion",
                "url": "https://example.org/podcast",
                "description": "A related discussion, not a reading.",
            },
        ]
        item["parts"][0]["audio"] = [
            {
                "label": "Exercise reading",
                "url": "https://example.org/exercise-audio",
                "description": "English excerpt.",
                "src": "https://media.example.org/exercise.wav",
            },
            {
                "label": "Unavailable audio",
                "url": "https://example.org/unavailable",
                "description": "A recording that has disappeared.",
                "src": "https://media.example.org/gone.wav",
            },
        ]
        site = Site(page, data)
        site.config["language"] = language
        site.media = {
            "https://media.example.org/" + name: buffer.getvalue()
            for name in ("reading.wav", "exercise.wav")
        }
        site.media["https://media.example.org/gone.wav"] = None
        site.open()
        expect(page.locator(".audio-option")).to_have_count(4)
        assert not any(url in site.media for url in site.requests)
        expect(page.locator("audio[src]")).to_have_count(0)
        expect(page.locator(".audio-option img, .audio-option iframe")).to_have_count(0)
        before = storage(page)
        first = page.locator(".audio-option").nth(0)
        expect(first).to_contain_text(HOSTILE)
        expect(
            page.locator(".audio-option").nth(2).locator(".audio-description")
        ).to_have_text(item["parts"][0]["audio"][0]["description"])
        expect(
            page.locator(".audio-option").nth(1).locator(".audio-start, audio")
        ).to_have_count(0)
        expect(first.locator(".audio-start")).to_contain_text(
            "Anhören · 30 sec" if language == "de" else "Listen · 30 sec"
        )
        expect(first.locator(".audio-warning")).to_be_visible()
        expect(first.locator(".audio-source")).to_be_hidden()
        first.locator(".audio-details").focus()
        page.keyboard.press("Enter")
        expect(first.locator(".audio-source")).to_be_visible()
        expect(first.locator(".audio-details")).to_have_attribute(
            "aria-expanded", "true"
        )
        assert not any(url in site.media for url in site.requests)
        first.locator(".audio-details").click()
        expect(first.locator(".audio-warning")).to_be_visible()
        expect(first.locator(".audio-description")).to_be_visible()
        first.locator(".audio-start").focus()
        page.keyboard.press("Enter")
        player = first.locator("audio")
        expect(player).to_be_visible()
        expect(player).to_be_focused()
        page.wait_for_function(
            "audio => audio.currentTime > 0", arg=player.element_handle()
        )
        player.evaluate("node => { node.currentTime = 5; }")
        page.wait_for_function(
            "audio => audio.currentTime >= 5", arg=player.element_handle()
        )
        page.locator(".audio-option").nth(2).locator(".audio-start").click()
        page.wait_for_function(
            "audio => audio.currentTime > 0",
            arg=page.locator(".audio-option").nth(2).locator("audio").element_handle(),
        )
        assert player.evaluate("node => node.paused")
        broken = page.locator(".audio-option").nth(3)
        broken.locator(".audio-start").click()
        expect(broken.locator('[role="status"]')).to_contain_text(
            "Quellenlink" if language == "de" else "source link"
        )
        expect(broken.locator("a")).to_have_attribute(
            "href", "https://example.org/unavailable"
        )
        expect(broken.locator("audio")).to_be_hidden()
        expect(broken.locator(".audio-source")).to_be_visible()
        expect(broken.locator(".audio-start")).to_have_text(
            "Erneut versuchen" if language == "de" else "Retry audio"
        )
        site.media["https://media.example.org/gone.wav"] = buffer.getvalue()
        broken.locator(".audio-start").click()
        page.wait_for_function(
            "audio => audio.currentTime > 0",
            arg=broken.locator("audio").element_handle(),
        )
        expect(broken.locator('[role="status"]')).to_have_text("")
        assert storage(page) == before, (
            "listening must not change reading progress or notes"
        )
        page.locator("#exportBtn").click()
        exported = page.locator("#handoffText").input_value()
        for recording in item["audio"] + item["parts"][0]["audio"]:
            for field in (
                "label",
                "description",
                "url",
                "duration",
                "warning",
                "details",
            ):
                if field in recording:
                    assert recording[field] in exported
            assert recording.get("src", "NO_MEDIA_URL") not in exported
        assert download_text(page) == exported
        page.locator("#handoffClose").click()
        card = page.locator("article.item").first
        summary = card.locator(".closeout > summary")
        expect(summary).to_contain_text("Quiz" if language == "de" else "quiz")
        expect(
            page.locator("article.item").nth(1).locator(".closeout > summary")
        ).not_to_contain_text("Quiz" if language == "de" else "quiz")
        summary_box = summary.bounding_box()
        skip_box = card.locator(".drop").bounding_box()
        assert card.locator(".drop").evaluate(
            "node => node.scrollWidth <= node.clientWidth"
        ), "skip label must fit without clipping"
        text_box = summary.locator(".summary-text").bounding_box()
        assert text_box["x"] + text_box["width"] <= skip_box["x"], (
            "notes and skip must not overlap"
        )
        assert abs(summary_box["y"] - skip_box["y"]) < 5, (
            "notes and skip share a footer row"
        )
        check_layout(page, width)
        if screenshots:
            page.screenshot(
                path=str(screenshots / f"audio-{language}-{width}.png"), full_page=True
            )
        card.locator(".head .box").click()
        assert broken.locator("audio").evaluate("audio => audio.paused")
        expect(card.locator(".drop")).to_be_hidden()
        assert (
            card.locator("h3").evaluate(
                "node => getComputedStyle(node).textDecorationLine"
            )
            == "line-through"
        )
        card.locator(".head .box").click()
        expect(card.locator(".drop")).to_be_visible()
        assert (
            card.locator("h3").evaluate(
                "node => getComputedStyle(node).textDecorationLine"
            )
            == "none"
        )
        site.healthy()
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for width in (1280, 390, 320):
            interactions(browser, width, args.screenshots)
        startup_errors(browser)
        incompatible_sync_stays_local(browser)
        immutable_release_root(browser)
        accessibility_regressions(browser)
        german_reader(browser, args.screenshots)
        audio_versions(browser, args.screenshots)
        browser.close()
    print("Synthetic domain, isolation, ordering, export and mobile acceptance passed")
