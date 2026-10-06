#!/bin/sh
# Assemble examples/book-club and examples/course as separate instances under OUT,
# plus a small index page. Used by .github/workflows/pages.yml; runs locally too:
#   sh scripts/build-demo.sh ../reader-demo && python3 -m http.server 8002 --directory ../reader-demo
set -eu
out=${1:?usage: build-demo.sh OUT_DIR (must not exist yet, outside this checkout)}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)  # left for the OS to clean up

mkdir "$out"  # fails if it exists: never write into an existing folder
for demo in book-club course; do
  inst="$work/$demo"
  mkdir -p "$inst"
  cp "$root/examples/$demo/list.json" "$inst/list.json"
  if [ -f "$root/examples/$demo/theme.css" ]; then
    # Instance files must not reuse reader asset names such as theme.css.
    cp "$root/examples/$demo/theme.css" "$inst/demo-theme.css"
    printf '{"content":"list.json","theme":"demo-theme.css"}\n' > "$inst/config.json"
  else
    printf '{"content":"list.json"}\n' > "$inst/config.json"
  fi
  node "$root/assemble.mjs" --instance "$inst" --out "$out/$demo"
done

cat > "$out/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reader demo</title>
<style>body{font:18px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem}</style>
<h1>Reader demo</h1>
<p>Two example reading lists built from <a href="https://github.com/jas-ho/reader">jas-ho/reader</a>. Titles and links are fictional. Progress and notes stay in your browser.</p>
<ul>
  <li><a href="book-club/">Book club</a>: reading list with progress, recall and notes</li>
  <li><a href="course/">Course</a>: same, with quizzes and a custom theme</li>
</ul>
HTML
