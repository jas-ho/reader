#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright", "pillow"]
# ///
"""Regenerate the README media from the examples: uv run scripts/demo-media.py

Writes docs/img/reader-demo.gif (book club: recall and a note, the chatbot handoff, Done next,
the contents sheet) and docs/img/course-example.png (the course with its theme).
Needs Playwright Chromium and gifski (https://gif.ski). Rerun after visible UI changes.
"""
import functools
import http.server
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "img"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/"


def main():
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp) / "site"
        subprocess.run(["sh", str(ROOT / "scripts" / "build-demo.sh"), str(site)], check=True, capture_output=True)
        server, base = serve(site)
        frames, pointer = Path(tmp) / "frames", None
        frames.mkdir()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()

            page = browser.new_page(viewport={"width": 1200, "height": 900})
            page.goto(base + "course/")
            page.wait_for_selector("article")
            page.wait_for_function("[...document.styleSheets].some(sheet => sheet.href?.endsWith('demo-theme.css'))")
            page.wait_for_load_state("load")
            page.screenshot(path=str(IMG / "course-example.png"))

            page = browser.new_page(viewport={"width": 1100, "height": 780})
            page.goto(base + "book-club/")
            page.wait_for_selector("article")

            def frame(times=1):
                path = frames / f"{len(list(frames.iterdir())):03}.png"
                page.screenshot(path=str(path))
                if pointer:  # a dot where the click lands, as a viewer would see a tap
                    image = Image.open(path).convert("RGB")
                    x, y = pointer
                    ImageDraw.Draw(image, "RGBA").ellipse((x - 13, y - 13, x + 13, y + 13), fill=(212, 92, 60, 150))
                    image.save(path)
                for _ in range(times - 1):
                    shutil.copy(path, frames / f"{len(list(frames.iterdir())):03}.png")

            def tap(locator, times=2):
                nonlocal pointer
                box = locator.bounding_box()
                pointer = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                frame(times)
                locator.click()
                pointer = None
                page.wait_for_timeout(500)
                frame(times)

            def type_into(locator, text):
                locator.click()
                for end in range(6, len(text) + 6, 6):
                    locator.fill(text[:end])
                    frame()

            card = page.locator("article.item").first
            frame(4)
            tap(card.locator(".closeout > summary"))
            type_into(card.locator("textarea.recall"), "The narrator keeps describing the garden wall, but never says who built it.")
            type_into(card.locator("textarea.notetext"), "Is the wall a memory or an invention?")
            frame(3)
            tap(card.locator(".copy1"))
            frame(4)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            tap(card.locator(".next1"), 3)
            tap(page.locator("#count"), 4)
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            frame(3)
            browser.close()
        server.shutdown()
        subprocess.run(["gifski", "--fps", "4", "--width", "1100", "--quality", "80", "-o", str(IMG / "reader-demo.gif"),
                        *sorted(str(p) for p in frames.iterdir())], check=True, capture_output=True)
    print(f"wrote {IMG / 'reader-demo.gif'} and {IMG / 'course-example.png'}")


main()
