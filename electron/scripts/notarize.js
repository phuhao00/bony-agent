/**
 * afterSign hook — submit the signed .app to Apple notarization and staple.
 * Skips on placeholder credentials or failure (signed-but-not-notarized still ships).
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

function hasValidNotarizeCreds() {
  const appleId = process.env.APPLE_ID;
  const password =
    process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
  if (!appleId || !password) return false;
  if (appleId === 'your@email.com') return false;
  if (password === 'xxxx-xxxx-xxxx-xxxx' || password.startsWith('xxxx-')) return false;
  return true;
}

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  if (process.env.MAC_BUILD_UNSIGNED === '1') {
    console.log('\n[notarize] Skipped — unsigned/ad-hoc build.\n');
    return;
  }

  if (!hasValidNotarizeCreds()) {
    console.warn(
      '\n[notarize] Skipped — 未配置有效公证凭据 (electron/mac-build.env)。\n' +
      '           包已 Developer ID 签名，其他 Mac 首次需 Control+点击 → 打开。\n'
    );
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword =
    process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID || 'CTYQJ59WDN';
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`\n[notarize] Submitting ${appPath} …`);

  try {
    const { notarize } = require('@electron/notarize');
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });

    console.log('[notarize] Stapling ticket to app bundle…');
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
    execSync(`xcrun stapler validate "${appPath}"`, { stdio: 'inherit' });
    console.log('[notarize] Notarization complete.\n');
  } catch (err) {
    console.warn(
      `\n[notarize] 公证失败（构建继续）: ${err.message}\n` +
      '           请检查 mac-build.env 中 Apple ID / App 专用密码是否正确。\n' +
      '           当前包已签名但未公证，用户首次需 Control+点击 → 打开。\n'
    );
  }
};
