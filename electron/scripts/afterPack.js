/**
 * afterPack hook — sign nested binaries for notarized builds only.
 *
 * IMPORTANT: Never ad-hoc `--deep` sign Electron bundles — that breaks nested
 * frameworks and shows「应用程序已损坏」on other Macs.
 */

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UNSIGNED = process.env.MAC_BUILD_UNSIGNED === '1';

function resolveIdentity() {
  if (UNSIGNED) return null;

  const fromEnv = process.env.CSC_NAME || process.env.APPLE_SIGNING_IDENTITY;
  if (fromEnv) return fromEnv;

  try {
    const out = execSync('security find-identity -v -p codesigning', {
      encoding: 'utf8',
    });
    const match = out.match(/"(Developer ID Application:[^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function isMachO(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.pyc', '.py', '.pyo', '.js', '.json', '.txt', '.md', '.pem'].includes(ext)) {
    return false;
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 4) return false;
    const header = fs.readFileSync(filePath).subarray(0, 4);
    const le = header.readUInt32LE(0);
    const be = header.readUInt32BE(0);
    const magics = new Set([
      0xfeedface, 0xfeedfacf, 0xcafebabe, // big-endian / fat headers
      0xcefaedfe, 0xcffaedfe, 0xbebafeca, // little-endian Mach-O
    ]);
    return magics.has(le) || magics.has(be);
  } catch {
    return false;
  }
}

/** Skip huge trees (venv-prebuilt alone is 500+ Mach-O); app-level sign + entitlements cover them. */
function shouldSkipWalkDir(dirName) {
  return (
    dirName === 'venv-prebuilt'
    || dirName === '__pycache__'
    || dirName === 'pip-wheels-mac'
    || dirName === 'pip-wheels-win'
    || dirName === '.git'
  );
}

function collectMachOBinaries(rootDir) {
  const binaries = [];
  const skip = new Set(['.app', '.framework', '.lproj']);

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkipWalkDir(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(path.extname(entry.name))) walk(fullPath);
        continue;
      }
      if (isMachO(fullPath)) binaries.push(fullPath);
    }
  }

  walk(rootDir);
  return binaries;
}

function signBinary(binaryPath, identity, entitlements) {
  const entArg = entitlements ? `--entitlements "${entitlements}"` : '';
  execSync(
    `codesign --force --options runtime --timestamp ${entArg} --sign "${identity}" "${binaryPath}"`,
    { stdio: 'inherit' }
  );
}

function adhocSignNestedBinaries(appPath) {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources', 'resources');
  const helperEntitlements = path.join(__dirname, '..', 'resources', 'entitlements.mac.helper.plist');
  if (!fs.existsSync(resourcesDir)) return;

  const binaries = collectMachOBinaries(resourcesDir);
  for (const binaryPath of binaries) {
    execSync(
      `codesign --force --sign - --entitlements "${helperEntitlements}" "${binaryPath}"`,
      { stdio: 'pipe' }
    );
  }
  if (binaries.length) {
    console.log(`[afterPack] Ad-hoc signed ${binaries.length} nested sidecar binary(ies) (venv-prebuilt excluded).`);
  }
}

function adhocSignApp(appPath, executableName) {
  const entitlements = path.join(__dirname, '..', 'resources', 'entitlements.mac.plist');
  const entitlementsInherit = path.join(__dirname, '..', 'resources', 'entitlements.mac.helper.plist');

  console.log(`\n[afterPack] Ad-hoc signing (with library-validation entitlement): ${appPath}`);
  adhocSignNestedBinaries(appPath);

  const { signAsync } = require('@electron/osx-sign');
  return signAsync({
    app: appPath,
    identity: '-',
    identityValidation: false,
    preAutoEntitlements: false,
    gatekeeperAssess: false,
    // Top-level entitlements are ignored by @electron/osx-sign; must use optionsForFile.
    optionsForFile: (filePath) => ({
      entitlements: filePath === appPath ? entitlements : entitlementsInherit,
      hardenedRuntime: true,
    }),
  }).then(() => {
    execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' });
    const out = execSync(
      `codesign -d --entitlements - "${path.join(appPath, 'Contents/MacOS', executableName)}"`,
      { encoding: 'utf8' }
    );
    if (!out.includes('disable-library-validation')) {
      throw new Error('[afterPack] disable-library-validation entitlement missing after sign');
    }
    console.log('[afterPack] Ad-hoc signing complete.\n');
  });
}

function pruneWindowsFilenames(resourcesDir) {
  const webStandalone = path.join(resourcesDir, 'web-standalone');
  if (!fs.existsSync(webStandalone)) return;

  const { execSync } = require('child_process');
  const script = path.join(__dirname, 'prune_windows_filenames.js');
  execSync(`node "${script}" "${webStandalone}"`, { stdio: 'inherit' });

  const invalid = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/[<>:"/\\|?*]/.test(ent.name)) invalid.push(full);
    }
  }
  walk(webStandalone);
  if (invalid.length) {
    throw new Error(
      `[afterPack] Windows-incompatible filenames remain (${invalid.length}): ${invalid[0]}`
    );
  }
  console.log('[afterPack] Windows filename prune complete.\n');
}

module.exports = async function afterPack({ appOutDir, packager }) {
  if (packager.platform.name === 'win') {
    const resourcesDir = path.join(appOutDir, 'resources', 'resources');
    if (fs.existsSync(resourcesDir)) pruneWindowsFilenames(resourcesDir);
    return;
  }

  if (packager.platform.name !== 'mac') return;

  const appName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (UNSIGNED) {
    await adhocSignApp(appPath, packager.appInfo.productFilename);
    return;
  }

  const identity = resolveIdentity();
  const helperEntitlements = path.join(__dirname, '..', 'resources', 'entitlements.mac.helper.plist');

  if (!identity) {
    console.warn('[afterPack] No Developer ID — falling back to ad-hoc signing.');
    await adhocSignApp(appPath, packager.appInfo.productFilename);
    return;
  }

  console.log(`\n[afterPack] Pre-signing nested Mach-O binaries with: ${identity}`);

  try {
    const resourcesDir = path.join(appPath, 'Contents', 'Resources', 'resources');
    if (fs.existsSync(resourcesDir)) {
      const binaries = collectMachOBinaries(resourcesDir);
      for (const binaryPath of binaries) {
        signBinary(binaryPath, identity, helperEntitlements);
      }
      console.log(`[afterPack] Signed ${binaries.length} nested sidecar binary(ies) (venv-prebuilt excluded).\n`);
    } else {
      console.warn('[afterPack] resources dir not found:', resourcesDir);
    }
  } catch (err) {
    throw new Error(`[afterPack] Nested binary signing failed: ${err.message}`);
  }
};
