#!/usr/bin/env node
/**
 * Replace node_modules/.bin symlinks with Windows-safe .cmd launchers.
 * macOS npm install creates Unix symlinks that break Windows Explorer unzip
 * without Developer Mode. Run before electron-builder on Windows packages.
 *
 * Usage: node materialize_npm_bins.js <bundle-root> [<bundle-root>...]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);

function isSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function toCmdRelPath(relTarget) {
  return relTarget.replace(/\//g, '\\');
}

function writeCmdShim(binDir, name, relTarget, useNode) {
  const rel = toCmdRelPath(relTarget);
  const lines = useNode
    ? [
        '@ECHO off',
        'SETLOCAL ENABLEEXTENSIONS',
        'SET "dp0=%~dp0"',
        `node "%dp0%${rel}" %*`,
        'ENDLOCAL',
        'EXIT /B %ERRORLEVEL%',
      ]
    : [
        '@ECHO off',
        'SETLOCAL ENABLEEXTENSIONS',
        'SET "dp0=%~dp0"',
        `"%dp0%${rel}" %*`,
        'ENDLOCAL',
        'EXIT /B %ERRORLEVEL%',
      ];
  const cmdPath = path.join(binDir, `${name}.cmd`);
  fs.writeFileSync(cmdPath, `${lines.join('\r\n')}\r\n`, 'utf8');
  return cmdPath;
}

function materializeBinDir(binDir) {
  if (!fs.existsSync(binDir)) {
    return { converted: 0, skipped: 0 };
  }

  let converted = 0;
  let skipped = 0;

  for (const name of fs.readdirSync(binDir)) {
    if (name.endsWith('.cmd') || name.endsWith('.ps1')) {
      skipped += 1;
      continue;
    }

    const binPath = path.join(binDir, name);
    if (!isSymlink(binPath)) {
      skipped += 1;
      continue;
    }

    const relTarget = fs.readlinkSync(binPath);
    const absTarget = path.resolve(binDir, relTarget);
    if (!fs.existsSync(absTarget)) {
      console.warn(`[materialize-bins] skip missing target: ${binPath} -> ${relTarget}`);
      skipped += 1;
      continue;
    }

    fs.unlinkSync(binPath);

    const ext = path.extname(absTarget).toLowerCase();
    const useNode = JS_EXTS.has(ext);

    if (useNode) {
      writeCmdShim(binDir, name, relTarget, true);
    } else {
      fs.copyFileSync(absTarget, binPath);
      writeCmdShim(binDir, name, relTarget, false);
    }

    converted += 1;
    console.log(`[materialize-bins] ${name} -> ${name}.cmd (${relTarget})`);
  }

  return { converted, skipped };
}

function materializeBundleRoot(rootDir) {
  const binDir = path.join(rootDir, 'node_modules', '.bin');
  if (!fs.existsSync(binDir)) {
    console.log(`[materialize-bins] no .bin in ${rootDir}`);
    return { converted: 0, skipped: 0 };
  }

  console.log(`[materialize-bins] processing ${binDir}`);
  return materializeBinDir(binDir);
}

function main() {
  const roots = process.argv.slice(2).filter(Boolean);
  if (!roots.length) {
    console.error('Usage: node materialize_npm_bins.js <bundle-root> [...]');
    process.exit(1);
  }

  let totalConverted = 0;
  let totalSkipped = 0;

  for (const root of roots) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      console.warn(`[materialize-bins] skip missing root: ${abs}`);
      continue;
    }
    const { converted, skipped } = materializeBundleRoot(abs);
    totalConverted += converted;
    totalSkipped += skipped;
  }

  console.log(
    `[materialize-bins] done — converted ${totalConverted}, skipped ${totalSkipped}`,
  );
}

main();
