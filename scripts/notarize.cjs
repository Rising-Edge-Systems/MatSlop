/**
 * US-042: macOS notarization afterSign hook for electron-builder.
 *
 * electron-builder calls this module with a context object after it has
 * code-signed the .app bundle. We use it to run the app through Apple's
 * notary service via @electron/notarize.
 *
 * Credentials are read from environment variables:
 *   - APPLE_ID                      Apple ID email for a Developer account.
 *   - APPLE_APP_SPECIFIC_PASSWORD   App-specific password generated at
 *                                   https://appleid.apple.com (NOT your
 *                                   normal Apple ID password).
 *   - APPLE_TEAM_ID                 Your 10-character Apple Developer Team ID.
 *
 * If ANY of those env vars is missing we log a clear "skipping" message and
 * return successfully — this matches the unsigned fallback behavior used by
 * US-040 (Windows code signing) so local dev / CI dry-runs don't fail.
 *
 * If @electron/notarize is not installed as a devDependency we also skip
 * gracefully and print the command to install it.
 */

const path = require('path')
const fs = require('fs')

/**
 * Pure helper: decide whether notarization should be skipped for the given
 * environment, and if so, why. Returns null when notarization should proceed.
 *
 * Exposed for unit tests so we can exercise the skip matrix without needing
 * a real electron-builder context.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function notarizeSkipReason(env) {
  const appleId = env.APPLE_ID
  const password = env.APPLE_APP_SPECIFIC_PASSWORD || env.APPLE_ID_PASSWORD
  const teamId = env.APPLE_TEAM_ID
  const missing = []
  if (!appleId) missing.push('APPLE_ID')
  if (!password) missing.push('APPLE_APP_SPECIFIC_PASSWORD')
  if (!teamId) missing.push('APPLE_TEAM_ID')
  if (missing.length > 0) {
    return `missing env vars: ${missing.join(', ')}`
  }
  return null
}

/**
 * electron-builder afterSign hook entry point.
 *
 * @param {{
 *   electronPlatformName: string,
 *   appOutDir: string,
 *   packager: { appInfo: { productFilename: string } },
 * }} context
 */
async function notarizeMac(context) {
  const { electronPlatformName, appOutDir, packager } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const skipReason = notarizeSkipReason(process.env)
  if (skipReason) {
    console.log(
      `[notarize] Skipping macOS notarization (${skipReason}). ` +
        `See docs/macos-notarization.md for setup instructions.`,
    )
    return
  }

  let notarizeFn
  try {
    // Dynamic import so this module loads even when @electron/notarize is
    // not installed (e.g. Linux-only CI builds).
    const mod = await import('@electron/notarize')
    notarizeFn = mod.notarize
  } catch (err) {
    console.warn(
      '[notarize] @electron/notarize is not installed; skipping. ' +
        'Run `npm install --save-dev @electron/notarize` to enable notarization.',
    )
    return
  }

  const appName = packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  if (!fs.existsSync(appPath)) {
    console.warn(`[notarize] Built app not found at ${appPath}; skipping.`)
    return
  }

  console.log(`[notarize] Submitting ${appPath} to Apple notary service...`)
  await notarizeFn({
    tool: 'notarytool',
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword:
      process.env.APPLE_APP_SPECIFIC_PASSWORD ||
      process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
  console.log('[notarize] Notarization complete.')
}

module.exports = notarizeMac
module.exports.default = notarizeMac
module.exports.notarizeSkipReason = notarizeSkipReason
