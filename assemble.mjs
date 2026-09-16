#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateList, validateConfig, validateCompatibility } from "./content.js";

import { translateShellHTML } from "./locale.js";

export const CORE_ASSETS = [
  "index.html", "reader.js", "content.js", "render.js", "state.js",
  "export.js", "sync.js", "locale.js", "styles.css", "theme.css", "favicon.svg", "LICENSE",
];
const ENGINE = path.dirname(fileURLToPath(import.meta.url));

const normalizedReference = value => value.replace(/^(?:\.\/)+/, "");

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Reject every symlink component, not only the final file. Assembly never follows
// a link from an instance into another directory, even if it points back inside.
async function safeFile(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.includes("\0") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe relative file path: ${JSON.stringify(relative)}`);
  }
  const segments = relative.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative file path: ${relative}`);
  }
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${relative}`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${relative}`);
    if (index === segments.length - 1 && !stat.isFile()) throw new Error(`Not a regular file: ${relative}`);
  }
  return readFile(current);
}

function parseJSON(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error(`${label}: ${error.message}`); }
}

function valid(errors, label) {
  if (errors.length) throw new Error(`${label}:\n${errors.map(error => `  ${error}`).join("\n")}`);
}

function revision(engine) {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const top = execFileSync("git", ["-C", engine, "rev-parse", "--show-toplevel"], options).trim();
    // A downloaded reader nested in another repository has no reader revision.
    if (realpathSync(top) !== engine) return null;
    return execFileSync("git", ["-C", engine, "rev-parse", "HEAD"], options).trim();
  }
  catch { return null; }
}

/** Package only an allowlist into a new folder. All input is read/validated first. */
export async function assemble({ instanceDir, outDir, engineDir = ENGINE }) {
  if (!instanceDir || !outDir) throw new Error("Both --instance and --out are required.");
  if ((await lstat(instanceDir)).isSymbolicLink()) throw new Error("Instance folder must not be a symlink.");
  const instance = await realpath(instanceDir);
  const engine = await realpath(engineDir);
  // Resolve the parent to detect output paths routed through symlinked ancestors.
  const requestedOut = path.resolve(outDir);
  if (await exists(requestedOut)) throw new Error("Output already exists; choose a new folder.");
  const parent = await realpath(path.dirname(requestedOut));
  const output = path.join(parent, path.basename(requestedOut));
  if (inside(instance, output) || inside(engine, output)) throw new Error("Output must be outside the instance and reader folders.");

  const configBytes = await safeFile(instance, "config.json");
  const config = parseJSON(configBytes, "config.json");
  valid(validateConfig(config), "config.json");
  const reserved = new Set([...CORE_ASSETS, "config.json", "release.json", ".index-pending"]);
  const files = new Map();
  for (const name of CORE_ASSETS) {
    // One fixed filename keeps the icon available before JavaScript loads.
    const source = name === "favicon.svg" && await exists(path.join(instance, name)) ? instance : engine;
    files.set(name, await safeFile(source, name));
  }
  files.set("config.json", configBytes);
  files.set("index.html", Buffer.from(translateShellHTML(files.get("index.html").toString("utf8"), config.language)));

  const references = [config.content, config.theme, config.compatibility].filter(Boolean).map(normalizedReference);
  for (const name of references) {
    if (reserved.has(name) || [...reserved].some(asset => name.startsWith(`${asset}/`))) {
      throw new Error(`Instance file collides with a reader asset: ${name}`);
    }
    if (files.has(name)) throw new Error(`Instance file has more than one role: ${name}`);
    files.set(name, await safeFile(instance, name));
  }
  const list = parseJSON(files.get(normalizedReference(config.content)), config.content);
  valid(validateList(list), config.content);
  if (config.compatibility) {
    const compatibility = parseJSON(files.get(normalizedReference(config.compatibility)), config.compatibility);
    valid(validateCompatibility(compatibility, list), config.compatibility);
  }

  const checkoutRevision = revision(engine);
  const changes = checkoutRevision ? execFileSync("git", ["-C", engine, "status", "--porcelain", "--untracked-files=normal", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() : "";
  // Unpinned previews are allowed, but a dirty tree must not claim to be HEAD.
  const readerRevision = changes ? null : checkoutRevision;
  if (await exists(path.join(instance, "reader-version"))) {
    const expected = (await safeFile(instance, "reader-version")).toString("utf8").trim();
    if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error("reader-version must contain a full 40-character Git commit SHA.");
    if (expected !== checkoutRevision) throw new Error("reader-version does not match the reader checkout HEAD. Check out the pinned commit first.");
    if (changes) throw new Error("Pinned assembly requires a clean reader working tree, including untracked files. Commit or set aside your changes first.");
  }
  files.set("release.json", Buffer.from(`${JSON.stringify({ schemaVersion: 1, readerRevision }, null, 2)}\n`));

  // mkdir is exclusive: another process cannot give us an existing output to
  // overwrite between validation and publication. Write index.html last so any
  // interrupted write is not a usable site. Never erase a pre-existing folder.
  await mkdir(output);
  try {
    for (const [name, bytes] of files) {
      if (name === "index.html") continue;
      const target = path.join(output, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    const pendingIndex = path.join(output, ".index-pending");
    await writeFile(pendingIndex, files.get("index.html"), { flag: "wx" });
    await rename(pendingIndex, path.join(output, "index.html"));
  } catch (error) {
    throw new Error(`Assembly failed; incomplete output at ${output} must not be published: ${error.message}`);
  }
  return { output, files: [...files.keys()], readerRevision };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes("--help")) {
      console.log("Usage: node assemble.mjs --instance <folder> --out <new-folder>\nThe output parent must exist; output must be outside reader and instance folders.");
    } else {
      const options = {};
      for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        if (!["--instance", "--out"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--") || options[key]) {
          throw new Error("Usage: node assemble.mjs --instance <folder> --out <new-folder>");
        }
        options[key] = args[index + 1];
      }
      const result = await assemble({ instanceDir: options["--instance"], outDir: options["--out"] });
      console.log(`Assembled ${result.files.length} files into ${result.output}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
