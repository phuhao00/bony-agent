#!/usr/bin/env node
/**
 * Rename files with Windows-invalid characters and patch references in bundled assets.
 * Next.js Turbopack may emit chunks like [externals]_node:stream_*.js — ":" breaks NTFS unzip.
 *
 * Usage: node prune_windows_filenames.js <target-dir>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const INVALID_RE = /[<>:"/\\|?*]/;
const TEXT_EXTS = new Set(['.js', '.json', '.map', '.mjs', '.cjs', '.txt', '.html']);

function sanitizeBaseName(name) {
  return name.replace(INVALID_RE, '_');
}

function walkDir(root, onEntry) {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      walkDir(full, onEntry);
    } else {
      onEntry(full);
    }
  }
}

function collectTextFiles(root) {
  const files = [];
  walkDir(root, (filePath) => {
    if (TEXT_EXTS.has(path.extname(filePath))) files.push(filePath);
  });
  return files;
}

function addReplacement(map, from, to) {
  if (!from || from === to || !map.has(from)) {
    if (from && from !== to) map.set(from, to);
  }
}

function buildReplacementMap(targetDir, renames) {
  const map = new Map();
  for (const { oldPath, newPath, oldBase, newBase } of renames) {
    const relOld = path.relative(targetDir, oldPath).split(path.sep).join('/');
    const relNew = path.relative(targetDir, newPath).split(path.sep).join('/');

    addReplacement(map, oldBase, newBase);
    addReplacement(map, relOld, relNew);
    addReplacement(map, `/${relOld}`, `/${relNew}`);

    // Source map / webpack-style URL encoding
    const enc = (s) => encodeURIComponent(s).replace(/%2F/g, '/');
    addReplacement(map, enc(oldBase), enc(newBase));
    addReplacement(map, enc(relOld), enc(relNew));

    // Partial path references inside chunk loaders
    const chunkOld = `server/chunks/${oldBase}`;
    const chunkNew = `server/chunks/${newBase}`;
    addReplacement(map, chunkOld, chunkNew);
  }
  return map;
}

function patchTextFiles(files, replacements) {
  const entries = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
  let patched = 0;
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [from, to] of entries) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(file, content);
      patched += 1;
    }
  }
  return patched;
}

function main() {
  const targetDir = process.argv[2];
  if (!targetDir || !fs.existsSync(targetDir)) {
    console.error('[prune-windows] usage: node prune_windows_filenames.js <target-dir>');
    process.exit(1);
  }

  const renames = [];
  walkDir(targetDir, (filePath) => {
    const base = path.basename(filePath);
    if (!INVALID_RE.test(base)) return;
    const newBase = sanitizeBaseName(base);
    if (newBase === base) return;
    renames.push({
      oldPath: filePath,
      newPath: path.join(path.dirname(filePath), newBase),
      oldBase: base,
      newBase,
    });
  });

  if (!renames.length) {
    console.log(`[prune-windows] OK — no invalid filenames under ${targetDir}`);
    return;
  }

  const replacements = buildReplacementMap(targetDir, renames);
  const textFiles = collectTextFiles(targetDir);
  const patched = patchTextFiles(textFiles, replacements);

  renames.sort((a, b) => b.oldPath.length - a.oldPath.length);
  for (const { oldPath, newPath, oldBase, newBase } of renames) {
    if (fs.existsSync(newPath)) {
      console.error(`[prune-windows] collision: ${newPath} already exists`);
      process.exit(1);
    }
    fs.renameSync(oldPath, newPath);
    console.log(`[prune-windows] renamed: ${oldBase} → ${newBase}`);
  }

  console.log(`[prune-windows] done — ${renames.length} file(s), ${patched} text file(s) patched`);
}

main();
