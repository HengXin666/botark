// electron-builder config (was the "build" key in package.json).
// Signing is optional: without the env vars below every build is unsigned,
// exactly like the earlier manual releases.
//   macOS CI (.p12):       CSC_LINK, CSC_KEY_PASSWORD
//   macOS local Keychain:  APPLE_SIGN=1 (or CSC_NAME="Developer ID Application: ...")
//   macOS Notarization:    (APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)
//                       or (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER)
//                       or (APPLE_KEYCHAIN_PROFILE [+ APPLE_KEYCHAIN])
//   Windows:               WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD
const has = (name) => Boolean(process.env[name] && process.env[name].trim())
const macSigned = has('CSC_LINK') || has('CSC_NAME') || process.env.APPLE_SIGN === '1'
const notarizeByAppleId =
  has('APPLE_ID') && has('APPLE_APP_SPECIFIC_PASSWORD') && has('APPLE_TEAM_ID')
const notarizeByApiKey =
  has('APPLE_API_KEY') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER')
const notarizeByKeychainProfile = has('APPLE_KEYCHAIN_PROFILE')
const notarize =
  macSigned && (notarizeByAppleId || notarizeByApiKey || notarizeByKeychainProfile)
const cliArgs = new Set(process.argv.slice(2))
const macArchs = cliArgs.has('--arm64')
  ? ['arm64']
  : cliArgs.has('--x64')
    ? ['x64']
    : ['arm64', 'x64']
// Use the repository that triggered a CI release, so forks publish their own
// AppImage/update manifests instead of trying to write to the upstream repo.
const [publishOwner, publishRepo] = (
  process.env.GITHUB_REPOSITORY || 'HengXin666/botark'
).split('/')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.qybaihe.botark',
  productName: 'BotArk',
  copyright: 'Copyright © 2026 BotArk contributors',
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  files: ['out/**/*', 'package.json'],
  asar: true,
  extraResources: [
    { from: 'build/mihomo', to: 'mihomo' },
    { from: 'dist/web', to: 'web' }
  ],
  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: macArchs },
      // zip is what electron-updater reads on macOS (latest-mac.yml).
      { target: 'zip', arch: macArchs }
    ],
    // null = skip signing entirely (unsigned build, as before).
    identity: macSigned ? undefined : null,
    hardenedRuntime: macSigned,
    gatekeeperAssess: false,
    // Skip non-code data files (covered by CodeResources) and framework symlink duplicates
    // so codesign only signs real Mach-O binaries & bundles once (TN2206 compliant, ~30x faster).
    signIgnore: [
      '\\.(pak|dat|bin|icns|car|asar|nib|strings|plist|json|txt|md|html|css|svg|png|woff2)$',
      '\\.framework/Versions/Current(/|$)',
      '\\.framework/(Electron Framework|Helpers|Libraries|Resources|Mantle|ReactiveObjC|Squirrel)(/|$)'
    ],
    notarize,
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  dmg: {
    sign: macSigned,
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.png',
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}'
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: 'build/icon.png',
    category: 'Utility;Development;',
    synopsis: 'All your personal AI agents in one Linux desktop workspace',
    description:
      'BotArk brings Grok Bot, ChatGPT Dot, Meta Muse, Hark, Hermes and Google Antigravity into one native desktop workspace.',
    maintainer: 'BotArk contributors',
    executableName: 'botark',
    // AppImage cannot ship a setuid chrome-sandbox. Keep Chromium's sandbox
    // enabled and rely on unprivileged user namespaces; users on kernels that
    // disable them can launch with --no-sandbox.
    executableArgs: [],
    syncDesktopName: true,
    desktop: {
      entry: {
        Name: 'BotArk',
        GenericName: 'AI Agent Workspace',
        Comment: 'All your personal AI agents in one desktop workspace',
        Categories: 'Utility;Development;',
        Keywords: 'AI;agent;chat;Grok;ChatGPT;Muse;Hark;Hermes;Antigravity;',
        StartupNotify: 'true',
        StartupWMClass: 'botark'
      }
    },
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  appImage: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // gzip decompresses faster than xz, so the first launch is quicker at the
    // cost of a slightly larger single-file AppImage.
    compression: 'gzip'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // Keep the user's data (accounts, sessions) on uninstall.
    deleteAppDataOnUninstall: false
  },
  publish: [
    {
      provider: 'github',
      owner: publishOwner,
      repo: publishRepo,
      // CI creates the draft first and every platform job uploads into it,
      // then one final step publishes. No job ever creates the release, so
      // parallel uploads cannot race into a 422.
      releaseType: 'draft'
    }
  ]
}
