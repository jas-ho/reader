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
import re
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
        self.theme_css = None
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
        elif relative == "custom-theme.css" and self.theme_css is not None:
            route.fulfill(body=self.theme_css, content_type="text/css")
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
            "favicon.svg",
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
    """Saved reading state; the device-local view key (position, skipped gates) is separate."""
    return page.evaluate(
        "Object.fromEntries(Object.entries(localStorage).filter(([k]) => !k.endsWith(':view')))"
    )


def check_layout(page, width):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
        f"overflow at {width}px"
    )
    # An open dialog scrolls on its own, so the page width would not show its overflow.
    assert page.evaluate("[...document.querySelectorAll('dialog[open]')].every(d => d.scrollWidth <= d.clientWidth)"), (
        f"dialog overflow at {width}px"
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
    expect(page.locator('link[rel="icon"]')).to_have_attribute("href", "./favicon.svg")
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
    expect(page.locator('link[rel="icon"]')).to_have_attribute(
        "href", release + "favicon.svg"
    )
    assert page.evaluate(
        "async () => (await fetch(document.querySelector('link[rel=icon]').href)).ok"
    )
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
        "favicon.svg",
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
    # open after reset, so focus moves to the gate that replaces it, in place
    # (not up to the summary, which on a phone is screens away).
    first.get_by_role("button", name="Reset this quiz", exact=True).click()
    expect(first.locator(".qbody")).to_be_hidden()
    expect(first.get_by_role("button", name="show the quiz without it.", exact=True)).to_be_focused()
    page.wait_for_timeout(450)  # the quiz folded under the finger: a quick second tap is ignored
    second.locator("summary").click()
    expect(second.locator(".qbody")).to_be_hidden()
    first.get_by_role("button", name="show the quiz without it.", exact=True).click()
    # Skipping lands on the question (its number and prompt), not on a choice.
    expect(first.locator(".qhead").first).to_be_focused()
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
    expect(quiz.locator(".q:visible .qcount")).to_have_text("Frage 1 von 2")
    quiz.locator('[data-choice="finite"]').first.click()
    expect(quiz.locator(".rat").first).to_contain_text("Richtig.")
    expect(quiz.locator(".qforward")).to_have_text("Nächste Frage")
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
        expect(summary).to_contain_text("Quiz")
        expect(
            page.locator("article.item").nth(1).locator(".closeout > summary")
        ).not_to_contain_text("Quiz")
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
        # A done reading folds to its title: no metadata, no body, no Skip.
        expect(card.locator(".drop")).to_be_hidden()
        expect(card.locator(".metadata")).to_be_hidden()
        expect(card.locator(".body")).to_be_hidden()
        card.locator(".head .box").click()
        expect(card.locator(".drop")).to_be_visible()
        expect(card.locator(".metadata")).to_be_visible()
        site.healthy()
        context.close()


def contents_and_drawer(browser):
    """Computed times, the contents sheet (dismiss vs navigate, sync while open, Next after a
    section jump), the drawer summary and end row, Copy, at 320px in both languages."""
    for language in ("en", "de"):
        data = nav_list()
        for i, item in enumerate(data["sections"][0]["items"]):
            item["minutes"] = 10 * (i + 1)
        data["sections"][1]["items"][0]["minutes"] = 5  # reading 4: its time goes when it is done
        data["sections"][0]["items"][0]["effort"] = ["Read chapters one to three and the appendix before continuing with the exercises"]
        context = browser.new_context(viewport={"width": 320, "height": 700}, has_touch=True)
        context.grant_permissions(["clipboard-read", "clipboard-write"])
        page = context.new_page()
        site = Site(page, data)
        site.config["language"] = language
        site.open()
        de = language == "de"
        card = lambda i: page.locator(f'.item[data-id="r{i}"]')
        count = page.locator("#count")
        # A sync widget sits in the bar too; the row must still fit.
        page.evaluate("document.querySelector('#syncMount').textContent = 'sync ✓'")

        # Counts and times are computed; a section with an untimed reading shows no time.
        expect(page.locator("#counts")).to_have_text("5 Texte" if de else "5 readings")
        expect(page.locator("#section-one .counts")).to_have_text("3 Texte · ~60 Min." if de else "3 readings · ~60 min")
        expect(page.locator("#section-two .counts")).to_have_text("2 Texte" if de else "2 readings")  # reading 5 has no time
        expect(card(1).locator(".metadata .minutes")).to_have_text("~10 Min." if de else "~10 min")
        check_layout(page, 320)

        # The drawer summary names its parts and marks what is filled, without repeating itself.
        summary = card(1).locator(".closeout > summary")
        expect(summary).to_have_text("›Erinnerung · Notiz · Quiz" if de else "›Recall · Note · Quiz")
        summary.click()
        # The fields carry their prompts (built-in here: the list sets none).
        expect(card(1).locator("textarea.recall")).to_have_attribute("placeholder", "Ohne nachzusehen: Was würdest du erklären oder hinterfragen?" if de else "Without looking back: what would you explain or question?")
        expect(card(1).locator("textarea.notetext")).to_have_attribute("placeholder", "Eine Aussage, eine Verbindung, eine Frage oder ein offener Punkt." if de else "A claim, a connection, a question, or a loose end.")
        card(1).locator("textarea.recall").fill("x")
        expect(summary).to_have_text("›Erinnerung ✓ · Notiz · Quiz" if de else "›Recall ✓ · Note · Quiz")
        # Questions group their choices; their letters are decoration, not part of the choice's name.
        card(1).locator(".quiz > summary").click()
        group = card(1).get_by_role("group", name="Question 0?")
        expect(group.locator(".opt").first).to_have_text("Answer A")
        expect(group.get_by_role("button", name="Answer A", exact=True)).to_be_visible()
        # One end row: clipboard, Close, Done next; all reachable and fitting at 320px.
        exits = card(1).locator(".exits")
        copy = exits.get_by_role("button", name="Im Chatbot verwenden" if de else "Use in your chatbot")
        rows = {round(b.bounding_box()["y"]) for b in exits.locator("button").all()}
        assert len(rows) == 1, f"end row wraps in {language}: {rows}"
        for b in exits.locator("button").all():
            box = b.bounding_box(); assert box["height"] >= 44 and box["width"] >= 44, box
        check_layout(page, 320)
        # Copy puts the prepared context on the clipboard and says so.
        copy.click()
        page.locator("#copyBtn").click()
        expect(page.locator("#copyMsg")).to_have_text("Kopiert. Füge es in deinen Chatbot ein." if de else "Copied. Paste it into your chatbot.")
        assert page.evaluate("navigator.clipboard.readText()") == page.locator("#handoffText").input_value()
        page.keyboard.press("Escape")
        expect(copy).to_be_focused()
        # When the clipboard refuses, the text is selected for the reader to copy by hand.
        copy.click()
        page.evaluate("() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); }")
        page.locator("#copyBtn").click()
        expect(page.locator("#copyMsg")).to_contain_text("Automatisches Kopieren" if de else "Could not copy")
        expect(page.locator("#handoffText")).to_be_focused()
        page.keyboard.press("Escape")
        expect(copy).to_be_focused()
        # The gate is one sentence.
        card(2).locator(".closeout > summary").click()
        card(2).locator(".quiz > summary").click()
        expect(card(2).locator(".gate")).to_have_text(
            "Schreibe zuerst auf, woran du dich erinnerst, oder zeig das Quiz gleich." if de
            else "Write your recall first, or show the quiz without it.")
        card(2).locator(".close1").click()

        # The contents sheet opens from the count and marks where the reader is.
        card(2).locator(".head h3").focus()
        expect(count).to_have_attribute("aria-label", "5 offen, Inhalt" if de else "5 left, contents")
        count.click()
        sheet = page.locator("#contents")
        expect(sheet).to_be_visible()
        expect(page.locator("#contentsCount")).to_have_text("5 offen" if de else "5 left")
        current = sheet.locator('.toc[aria-current="true"]')
        expect(current).to_contain_text("Reading 2"); expect(current).to_be_focused()
        check_layout(page, 320)
        # Dismissing returns to the count; nothing moved.
        page.keyboard.press("Escape")
        expect(count).to_be_focused()
        # A remote change while the sheet is open repaints its states in place.
        count.click()
        expect(sheet.locator("li").filter(has_text="Reading 4").locator(".time")).to_be_visible()
        page.evaluate("p => { const s = p.get(); s.items = {...s.items, r4: 'done'}; p.set(s); }", page.evaluate_handle("window.readerPage"))
        row4 = sheet.locator("li").filter(has_text="Reading 4")
        expect(row4).to_have_attribute("data-state", "done")
        expect(row4.locator(".sr")).to_have_text(", gelesen" if de else ", done")
        expect(row4.locator(".time")).to_be_hidden()
        expect(page.locator("#contentsCount")).to_have_text("4 offen" if de else "4 left")
        # Navigating focuses the target, not the count. A section jump makes Next start there.
        sheet.locator("h3 .toc").filter(has_text="Two").click()
        expect(sheet).to_be_hidden()
        expect(page.locator("#section-two h2")).to_be_focused()
        page.wait_for_timeout(450)
        page.locator("#hint .jump").click()
        expect(card(5).locator(".head h3")).to_be_focused()  # r4 is done
        count.click()
        sheet.locator(".toc").filter(has_text="Reading 1").click()
        expect(card(1).locator(".head h3")).to_be_focused()
        count.click()
        sheet.locator(".toc").first.click()  # top of page
        expect(page.locator("h1")).to_be_focused()
        assert page.evaluate("scrollY") < 60
        page.wait_for_timeout(450)
        page.locator("#hint .jump").click()
        expect(card(1).locator(".head h3")).to_be_focused()
        # The last section is short: the page cannot scroll it to the top, Next still starts there.
        page.evaluate("p => { const s = p.get(); s.items = {...s.items, r1: 'done', r2: 'done', r3: 'done'}; p.set(s); }", page.evaluate_handle("window.readerPage"))
        count.click(); sheet.locator("h3 .toc").filter(has_text="Two").click()
        page.wait_for_timeout(450)
        page.locator("#hint .jump").click()
        expect(card(5).locator(".head h3")).to_be_focused()
        # All done: the count says so, inside the sheet too.
        page.evaluate("p => { const s = p.get(); s.items = {...s.items, r5: 'done'}; p.set(s); }", page.evaluate_handle("window.readerPage"))
        expect(count).to_have_text("Alles erledigt" if de else "All done")
        count.click(); expect(page.locator("#contentsCount")).to_have_text("Alles erledigt" if de else "All done")
        page.keyboard.press("Escape")
        site.healthy()
        context.close()


def parts_and_deep_links(browser):
    """Ticking a part of a finished reading never reopens it (unticking does), and a link to a
    section opens the list there."""
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    data = course()
    data["sections"][0]["items"][0]["parts"].append({"id": "second-exercise", "title": "A second exercise"})
    data["sections"][0]["items"][0]["scope"] = "paragraphs 1 to 3"
    data["sections"][0]["items"][0]["links"][0]["jumps"] = [
        {"label": "A long jump label that wraps onto a second line on a narrow phone screen", "url": "https://example.org/r.pdf#page=6&zoom=100"},
        {"label": "Page zero is no page", "url": "https://example.org/r.pdf#page=0"},
        {"label": "A quoted line", "url": "https://example.org/reading#:~:text=quoted"},
    ]
    site = Site(page, data)
    site.open()
    card = page.locator('.item[data-id="first-reading"]')
    # Phones often ignore #page, so a PDF page jump shows its page number, outside the link.
    expect(card.locator(".jumps .page-hint")).to_have_count(1)
    expect(card.locator(".jumps li").first.locator(".page-hint")).to_have_text(" · PDF page 6")
    expect(card.locator(".jumps a").first).to_have_text("A long jump label that wraps onto a second line on a narrow phone screen")
    check_layout(page, 390)
    # What to read sits right above the sources it refers to.
    scope = card.locator(".body > .scope")
    expect(scope).to_have_text("Read: paragraphs 1 to 3")
    assert scope.evaluate("p => p.nextElementSibling.matches('.source-links')")
    card.locator(".head .box").click()
    expect(card).to_have_attribute("data-state", "done")
    card.locator(".item-footer > .show").click()
    part = card.locator('.subs li[data-id="first-exercise"] .box')
    part.click()
    expect(card).to_have_attribute("data-state", "done")
    part.click()  # unticking a part reopens the reading
    expect(card).not_to_have_attribute("data-state", "done")
    site.healthy()
    context.close()

    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    site = Site(page, nav_list())
    page.goto(ORIGIN + site.prefix + "#section-two")
    page.wait_for_function("Boolean(window.readerPage)")
    page.wait_for_function("Math.abs(document.getElementById('section-two').getBoundingClientRect().top) < 40")
    site.healthy()
    context.close()


def home_link(browser):
    context = browser.new_context()
    page = context.new_page()
    site = Site(page, book_club())
    site.open()
    expect(page.locator(".item")).to_have_count(1)
    expect(page.locator("#home-link")).to_be_hidden()
    context.close()
    context = browser.new_context()
    page = context.new_page()
    site = Site(page, book_club())
    site.config["homeLink"] = {"label": "All lists <b>", "url": "/"}
    site.open()
    link = page.locator("footer #home-link a")
    expect(link).to_have_text("All lists <b>")
    assert link.get_attribute("href") == "/"
    site.healthy()
    context.close()


def quiz_result_colours(browser):
    """Quiz results use semantic tokens (defaulting to the palette), carry marks, and the
    row tint follows the result; a theme can separate correct from accent."""
    custom = (
        ":root{--correct:#1f7a3a;--correct-soft:#e2f0e5}"
        "@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--correct:#6fcb8a;--correct-soft:#1d2e22}}"
    )
    expected = {"light": "rgb(31, 122, 58)", "dark": "rgb(111, 203, 138)"}
    for theme in (None, custom):
        for scheme in ("light", "dark"):
            context = browser.new_context(viewport={"width": 320, "height": 900}, color_scheme=scheme)
            page = context.new_page()
            site = Site(page, course())
            if theme:
                site.config["theme"] = "custom-theme.css"
                site.theme_css = theme
            site.open()
            card = page.locator('.item[data-id="first-reading"]')
            card.locator(".closeout > summary").click()
            card.locator(".quiz > summary").click()
            card.locator(".gate button").click()
            questions = card.locator(".q")
            questions.nth(0).locator(".opt").filter(has_text="An infinite set").click()  # wrong
            card.locator(".qforward").click()
            page.wait_for_timeout(450)  # past the tap guard after stepping
            questions.nth(1).locator(".opt").filter(has_text="The empty set").click()  # right
            card.locator(".qstep").first.click()  # back to the first question to read its colours
            page.wait_for_timeout(450)  # also lets the background transition settle before reading colours
            style = lambda loc, prop, pseudo="null": loc.evaluate(
                f"(el, p) => getComputedStyle(el, {pseudo}).getPropertyValue(p)", prop
            )
            correct = questions.nth(0).locator(".opt.correct")
            wrong = questions.nth(0).locator(".opt.wrong")
            # The computed colour a token resolves to, read through a throwaway element.
            resolve = lambda name, prop="color": page.evaluate(
                "([n, p]) => { const d = document.createElement('i'); d.style[p] = `var(${n})`;"
                " document.body.append(d); const c = getComputedStyle(d)[p]; d.remove(); return c; }",
                [name, prop],
            )
            want_correct = expected[scheme] if theme else resolve("--accent")
            want_wrong = resolve("--signal")
            # Results show as a tint on the row plus a coloured mark.
            assert style(correct, "color", "'::after'") == want_correct, (theme, scheme)
            assert style(wrong, "color", "'::after'") == want_wrong, (theme, scheme)
            assert style(correct, "background-color") == resolve("--correct-soft", "backgroundColor"), (theme, scheme)
            assert style(wrong, "background-color") == resolve("--wrong-soft", "backgroundColor"), (theme, scheme)
            assert "✓" in style(correct, "content", "'::after'"), "correct mark"
            assert "✗" in style(wrong, "content", "'::after'"), "wrong mark"
            assert style(questions.nth(1).locator(".opt").filter(has_text="A pair"), "content", "'::after'") in ("none", "normal")
            check_layout(page, 320)
            site.healthy()
            context.close()


def stepper_list():
    """One reading with a five-question quiz (a tall first question) and one with a single question."""
    tall = " ".join(["A long choice that wraps over several lines on a phone."] * 6)
    question = lambda i, text="Short": {"id": f"s{i}", "prompt": f"Question {i}?", "choices": [
        {"id": "a", "text": f"{text} A{i}"}, {"id": "b", "text": f"{text} B{i}"}], "answer": "a",
        "explanation": f"Because of {i}."}
    return {"schemaVersion": 1, "id": "stepper-test", "title": "Stepper test", "sections": [
        {"id": "one", "title": "One", "items": [
            {"id": "five", "title": "Five questions", "quizzes": [{"id": "steps", "title": "Check", "questions": [
                question(1, tall), *[question(i) for i in range(2, 6)]]}]},
            {"id": "single", "title": "One question", "quizzes": [{"id": "only", "title": "Check", "questions": [question(9)]}]},
            {"id": "long", "title": "Thirteen questions", "quizzes": [{"id": "many", "title": "Check", "questions": [
                question(i) for i in range(10, 23)]}]}]}]}


def quiz_stepper(browser):
    """One question at a time: steps, Previous/Next, a guarded second tap, the result, remote changes, reload."""
    context = browser.new_context(viewport={"width": 320, "height": 640})
    page = context.new_page()
    site = Site(page, stepper_list())
    site.open()
    card = page.locator('.item[data-id="five"]')
    quiz = card.locator(".quiz")
    answers = lambda: page.evaluate("Object.fromEntries(Object.entries(window.readerPage.get().quiz).filter(([k]) => k.startsWith('steps/')))")
    visible = lambda: quiz.locator(".q:visible")
    in_view = lambda loc: loc.evaluate("el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight - 60; }")
    card.locator(".closeout > summary").click()
    quiz.locator("summary").click()
    quiz.locator(".gate button").click()
    expect(visible()).to_have_count(1)
    expect(visible().locator(".qcount")).to_have_text("Question 1 of 5")
    steps = quiz.locator(".qstep")
    expect(steps).to_have_count(5)
    expect(steps.first).to_have_attribute("aria-current", "step")
    expect(steps.first).to_have_attribute("aria-label", "Question 1: not answered")
    for chip in steps.all():
        box = chip.bounding_box(); assert box["height"] >= 44 and box["width"] >= 44, box
    back, forward = quiz.locator(".qback"), quiz.locator(".qforward")
    expect(back).to_be_hidden()
    expect(forward).to_have_text("Skip question")
    # The outcome's status region is in place before answering, empty.
    expect(visible().locator(".rat")).to_have_text("")
    expect(visible().locator(".rat")).to_have_attribute("role", "status")

    visible().get_by_role("button", name=re.compile("A1$")).click()
    expect(visible().locator(".rat")).to_have_text("Correct. Because of 1.")
    expect(steps.first).to_have_text("1 ✓")
    expect(steps.first).to_have_attribute("aria-label", "Question 1: right")
    expect(forward).to_have_text("Next question")
    expect(forward).to_have_class(re.compile("primary"))
    # The tall question runs below the screen; Next stays reachable above the bar without scrolling.
    assert in_view(forward), forward.bounding_box()

    # A quick second tap after Next must not answer the next question, which moved under the finger.
    forward.scroll_into_view_if_needed()
    box = forward.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.click(x, y)
    head = quiz.locator(".q:visible .qhead")
    expect(head).to_be_focused()
    expect(head.locator(".qcount")).to_have_text("Question 2 of 5")
    page.mouse.click(x, y)
    assert answers() == {"steps/s1": "a"}, answers()
    assert in_view(head), "the new question starts on screen"
    page.wait_for_timeout(450)

    # Previous and the steps move without answering anything.
    back.click(); expect(head.locator(".qcount")).to_have_text("Question 1 of 5")
    page.wait_for_timeout(450)
    steps.nth(3).click(); expect(head.locator(".qcount")).to_have_text("Question 4 of 5")
    expect(steps.nth(3)).to_have_attribute("aria-current", "step")
    expect(steps.first).not_to_have_attribute("aria-current", "step")
    assert answers() == {"steps/s1": "a"}
    page.wait_for_timeout(450)
    visible().get_by_role("button", name="Short B4", exact=True).click()  # wrong
    expect(visible().locator(".rat")).to_have_text("Incorrect. Correct answer: Short A4. Because of 4.")
    expect(steps.nth(3)).to_have_text("4 ✗")
    steps.nth(4).click(); page.wait_for_timeout(450)
    expect(forward).to_have_text("See result")

    # The result: partial, with a way back to the first open question.
    forward.click()
    result = quiz.locator(".qresult-line")
    expect(result).to_be_focused()
    expect(result).to_have_text("1 right · 2 of 5 answered")
    expect(visible()).to_have_count(0)
    expect(quiz.locator(".qnav")).to_be_hidden()
    assert quiz.locator('.qstep[aria-current]').count() == 0
    page.wait_for_timeout(450)
    quiz.locator(".qresume").click()
    expect(head.locator(".qcount")).to_have_text("Question 2 of 5")

    # A remote answer repaints without moving the step.
    page.evaluate("p => { const s = p.get(); p.set({...s, quiz: {...s.quiz, 'steps/s3': 'a'}}); }", page.evaluate_handle("window.readerPage"))
    expect(steps.nth(2)).to_have_text("3 ✓")
    expect(head.locator(".qcount")).to_have_text("Question 2 of 5")
    page.wait_for_timeout(450)
    for i in (2, 5):
        steps.nth(i - 1).click(); page.wait_for_timeout(450)
        visible().get_by_role("button", name=f"Short A{i}", exact=True).click()
    forward.click()
    expect(result).to_have_text("4 of 5 right")
    expect(quiz.locator(".qhint")).to_be_visible()
    expect(quiz.locator(".qresume")).to_be_hidden()

    # Reload: a finished quiz opens at its result; one with gaps at its first open question.
    page.reload(); page.wait_for_function("Boolean(window.readerPage)")
    card.locator(".closeout > summary").click(); quiz.locator("summary").click()
    expect(result).to_be_visible(); expect(result).to_have_text("4 of 5 right")
    # A reset elsewhere while the result is shown: back to question 1, nothing answered.
    page.evaluate("p => { const s = p.get(); p.set({...s, quiz: {}}); }", page.evaluate_handle("window.readerPage"))
    expect(head.locator(".qcount")).to_have_text("Question 1 of 5")
    expect(quiz.locator(".qresult")).to_be_hidden()
    page.evaluate("p => { const s = p.get(); p.set({...s, quiz: {'steps/s1': 'a', 'steps/s2': 'a'}}); }", page.evaluate_handle("window.readerPage"))
    page.reload(); page.wait_for_function("Boolean(window.readerPage)")
    card.locator(".closeout > summary").click(); quiz.locator("summary").click()
    expect(head.locator(".qcount")).to_have_text("Question 3 of 5")

    # One question: no steps, no Previous/Next, no result; Reset stays.
    single = page.locator('.item[data-id="single"]')
    single.locator(".closeout > summary").click(); single.locator(".quiz > summary").click()
    single.locator(".gate button").click()
    expect(single.locator(".qstep")).to_have_count(0)
    expect(single.locator(".qnav")).to_have_count(0)
    expect(single.locator(".qcount")).to_have_count(0)
    single.get_by_role("button", name="Short A9", exact=True).click()
    expect(single.locator(".rat")).to_have_text("Correct. Because of 9.")
    expect(single.get_by_role("button", name="Reset this quiz", exact=True)).to_be_visible()

    # Thirteen questions keep their steps in one row that scrolls sideways, the current step in view.
    long = page.locator('.item[data-id="long"]')
    long.locator(".closeout > summary").click(); long.locator(".quiz > summary").click()
    # The recall gate low on the screen: skipping it scrolls the steps up, so a quick second tap on what
    # moved there (here Done, next) is ignored.
    gate = long.locator(".gate button")
    page.evaluate("y => scrollBy(0, y - innerHeight * 0.75)", gate.bounding_box()["y"])
    gate.click()
    expect(long.locator(".qhead").first).to_be_focused()
    assert in_view(long.locator(".qsteps")), "the steps come up into view"
    long.locator(".next1").click()
    assert page.evaluate("window.readerPage.get().items.long") is None, "the second tap went through"
    page.wait_for_timeout(450)
    steps = long.locator(".qstep")
    steps.nth(10).click()
    current = long.locator('.qstep[aria-current="step"]')
    expect(current).to_have_text("11")
    assert len({round(c.bounding_box()["y"]) for c in steps.all()}) == 1, "steps wrap"
    whole = "c => { const r = c.getBoundingClientRect(), s = c.parentElement.getBoundingClientRect(); return r.left >= s.left - 0.5 && r.right <= s.right + 0.5; }"
    assert current.evaluate(whole)
    # Skipping every question still reaches the result.
    page.wait_for_timeout(450)
    steps.last.click(); page.wait_for_timeout(450)
    long.locator(".qforward").click()
    expect(long.locator(".qresult-line")).to_be_visible()
    expect(long.locator(".qresult-line")).to_have_text("0 right · 0 of 13 answered")
    expect(long.locator(".qresume")).to_have_text("Continue with question 1")
    # Outcomes arriving from elsewhere widen the steps; the current one stays whole.
    page.wait_for_timeout(450)
    steps.last.click()
    page.evaluate("p => { const s = p.get(), quiz = {...s.quiz}; for (let i = 10; i < 23; i++) quiz[`many/s${i}`] = 'a'; p.set({...s, quiz}); }", page.evaluate_handle("window.readerPage"))
    expect(steps.last).to_have_text("13 ✓")
    assert steps.last.evaluate(whole), "current step clipped"
    # The same while the drawer is closed: it is checked again when the drawer opens.
    page.evaluate("p => { const s = p.get(); p.set({...s, quiz: {}}); }", page.evaluate_handle("window.readerPage"))
    expect(steps.last).to_have_text("13")
    page.wait_for_timeout(450)  # past the tap guard of the last step
    drawer = long.locator(".closeout")
    drawer.locator("> summary").click(); expect(drawer).not_to_have_attribute("open", "")
    page.evaluate("p => { const s = p.get(), quiz = {...s.quiz}; for (let i = 10; i < 23; i++) quiz[`many/s${i}`] = 'a'; p.set({...s, quiz}); }", page.evaluate_handle("window.readerPage"))
    drawer.locator("> summary").click(); expect(drawer).to_have_attribute("open", "")
    expect(steps.last).to_be_visible()
    expect(steps.last).to_have_text("13 ✓")
    assert steps.last.evaluate(whole), "current step clipped after reopening"
    check_layout(page, 320)
    site.healthy()
    context.close()


def nav_list():
    """Five long readings in two sections, two with quizzes, for navigation and folding."""
    long = " ".join(["A paragraph that makes each reading taller than a phone screen."] * 30)
    quiz = lambda n: [{"id": f"q{n}", "title": "Check", "questions": [
        {"id": f"q{n}-{i}", "prompt": f"Question {i}?", "choices": [
            {"id": "a", "text": "Answer A"}, {"id": "b", "text": "Answer B"}], "answer": "a"}
        for i in range(3)]}]
    item = lambda i: {"id": f"r{i}", "title": f"Reading {i}", "description": long,
                      **({"quizzes": quiz(i)} if i < 3 else {})}
    return {"schemaVersion": 1, "id": "nav-test", "title": "Navigation test", "sections": [
        {"id": "one", "title": "One", "items": [item(1), item(2), item(3)]},
        {"id": "two", "title": "Two", "items": [item(4), item(5)]}]}


def navigation(browser):
    """Exits at the end of the drawer, positional next, Show, sync-safe view state, restore."""
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    site = Site(page, nav_list())
    site.open()
    card = lambda i: page.locator(f'.item[data-id="r{i}"]')
    heading = lambda i: card(i).locator(".head h3")
    top = lambda loc: loc.evaluate("el => el.getBoundingClientRect().top")
    jump = page.locator("#hint .jump")
    expect(jump).to_have_text("Next ↓")

    # From the masthead, Next goes to the first unfinished reading, then advances each time.
    # Taps follow each other quickly, as on a phone: no waiting for the smooth scroll to settle.
    jump.click(); expect(heading(1)).to_be_focused()
    jump.click(); expect(heading(2)).to_be_focused()
    jump.click(); expect(heading(3)).to_be_focused()
    page.wait_for_function("Math.abs(document.querySelector('.item[data-id=r3]').getBoundingClientRect().top) < 40")

    # Ticking done no longer opens the drawer.
    card(3).locator(".head .box").click()
    expect(card(3)).to_have_attribute("data-state", "done")
    assert not card(3).locator(".closeout").evaluate("d => d.open")
    # Show reveals a done reading without changing progress; Hide folds it again.
    show = card(3).locator(".item-footer > .show")
    expect(show).to_have_text("Show"); expect(card(3).locator(".body")).to_be_hidden()
    show.click()
    expect(card(3).locator(".body")).to_be_visible(); expect(show).to_have_attribute("aria-expanded", "true")
    expect(card(3)).to_have_attribute("data-state", "done")
    show.click(); expect(card(3).locator(".body")).to_be_hidden()

    # End of a long drawer: Close folds it and lands on its summary, in view.
    card(1).locator(".closeout > summary").click()
    card(1).locator(".quiz > summary").click()
    card(1).locator(".gate button").click()
    page.wait_for_timeout(450)  # the gate sat low: skipping it scrolled the quiz up, behind a tap guard
    for _ in range(3):  # one question at a time, past the tap guard after each step
        card(1).locator(".q:visible .opt").first.click()
        card(1).locator(".qforward").click()
        page.wait_for_timeout(450)
    expect(card(1).locator(".qresult-line")).to_have_text("3 of 3 right")
    card(1).locator(".close1").scroll_into_view_if_needed()
    card(1).locator(".close1").click()
    summary = card(1).locator(".closeout > summary")
    assert not card(1).locator(".closeout").evaluate("d => d.open")
    expect(summary).to_be_focused()
    assert 0 <= top(summary) < 844 - 60, top(summary)

    # A remote update leaves view state alone: an open drawer and a shown reading stay as they are.
    card(2).locator(".closeout > summary").click()
    show.click()
    page.evaluate("p => { const s = p.get(); s.notes = {...s.notes, r5: 'from another device'}; p.set(s); }", page.evaluate_handle("window.readerPage"))
    assert card(2).locator(".closeout").evaluate("d => d.open")
    expect(card(3).locator(".body")).to_be_visible()

    # Done, next: marks done, folds, and moves to the next unfinished reading after this one.
    # Reading 3 is shown in full, so reading 4 starts more than half a screen below 2: it goes to the top.
    card(2).locator(".next1").scroll_into_view_if_needed()
    expect(card(2).locator(".next1")).to_have_text("Done, next")
    card(2).locator(".next1").click()
    expect(card(2)).to_have_attribute("data-state", "done")
    assert not card(2).locator(".closeout").evaluate("d => d.open")
    expect(heading(4)).to_be_focused()
    assert abs(top(card(4))) < 40, top(card(4))
    assert not card(4).locator(".closeout").evaluate("d => d.open")

    # A quick second tap after Done, next must not act on whatever moved under the finger.
    page.wait_for_timeout(450)  # past the guard window of the previous jump
    card(4).locator(".closeout > summary").click()
    card(4).locator(".next1").scroll_into_view_if_needed()
    before = page.evaluate("window.readerPage.get().items")
    box = card(4).locator(".next1").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.click(x, y)  # Done, next: the page jumps to reading 5
    expect(heading(5)).to_be_focused()
    page.mouse.click(x, y)  # the same finger again, now over reading 5
    # Reading 5 follows close below: the reading just finished stays in sight on top, 5 under it.
    page.wait_for_function("Math.abs(document.querySelector('.item[data-id=r4]').getBoundingClientRect().top) < 40")
    assert 0 < top(card(5)) < 844 / 2, top(card(5))
    assert page.evaluate("window.readerPage.get().items") == {**before, "r4": "done"}
    # Keyboard activation right after a jump is never a stray tap.
    page.wait_for_timeout(450)
    jump.click(); expect(heading(1)).to_be_focused()
    page.keyboard.press("Tab"); page.keyboard.press("Enter")
    assert card(1).locator(".closeout").evaluate("d => d.open"), "Enter right after a jump must act"
    card(1).locator(".closeout > summary").click()
    page.wait_for_timeout(450)
    card(4).locator(".head .box").click()  # back to unfinished for the steps below
    expect(card(4)).not_to_have_attribute("data-state", "done")
    heading(4).focus()

    # The recall skip and the position survive a reload; folds start closed.
    page.reload(); page.wait_for_function("Boolean(window.readerPage)")
    page.wait_for_timeout(300)
    assert abs(top(card(4))) < 60, top(card(4))
    assert page.evaluate("document.querySelectorAll('details[open]').length") == 0
    card(1).locator(".closeout > summary").click(); card(1).locator(".quiz > summary").click()
    expect(card(1).locator(".gate")).to_be_hidden()
    # The skip itself survived, not only the answers: after a reset, the gate stays open.
    card(1).get_by_role("button", name="Reset this quiz", exact=True).click()
    expect(card(1).locator(".gate")).to_be_hidden()
    expect(card(1).locator(".qbody")).to_be_visible()
    expect(card(1).locator(".q:visible .qhead")).to_be_focused()  # back to question 1
    page.wait_for_timeout(450)  # past the tap guard after the reset

    # Last unfinished reading: Done, next stays on it and the bar reports completion.
    for i in (1, 5):
        card(i).locator(".head .box").click()
    card(4).locator(".closeout > summary").click()
    card(4).locator(".next1").click()
    expect(heading(4)).to_be_focused()
    expect(page.locator("#count")).to_have_text("All done")
    expect(jump).to_be_hidden()
    check_layout(page, 390)
    site.healthy()
    context.close()

    # 320 px, German, with a sync pill in the bar: Next stays whole and tappable.
    context = browser.new_context(viewport={"width": 320, "height": 640})
    page = context.new_page()
    site = Site(page, nav_list())
    site.config["language"] = "de"
    site.open()
    page.evaluate("document.querySelector('#syncMount').append(Object.assign(document.createElement('button'), {textContent: 'Sync aus'}))")
    jump = page.locator("#hint .jump")
    expect(jump).to_have_text("Weiter ↓")
    box = jump.bounding_box()
    assert box["width"] >= 44 and box["height"] >= 44, box
    assert jump.evaluate("el => el.scrollWidth <= el.clientWidth"), "Next label truncated"
    check_layout(page, 320)
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
        home_link(browser)
        quiz_result_colours(browser)
        quiz_stepper(browser)
        navigation(browser)
        contents_and_drawer(browser)
        parts_and_deep_links(browser)
        immutable_release_root(browser)
        accessibility_regressions(browser)
        german_reader(browser, args.screenshots)
        audio_versions(browser, args.screenshots)
        browser.close()
    print("Synthetic domain, isolation, ordering, export and mobile acceptance passed")
