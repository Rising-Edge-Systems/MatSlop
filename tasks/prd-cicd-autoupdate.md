# PRD: CI/CD Pipeline & Auto-Update

## Introduction

MatSlop needs a CI/CD pipeline that builds installer artifacts for Windows, macOS, and Linux when a git tag (e.g., `v1.0.0`) is pushed, publishes them as a GitHub Release, and enables the app to notify users when updates are available. The auto-update backend (`updateBridge.ts`) and electron-builder config already exist — this PRD covers the GitHub Actions workflow, the in-app update banner UI, and the release process.

## Goals

- Push a tag like `v1.0.0` → GitHub Actions builds Windows (.exe), macOS (.dmg), and Linux (.AppImage/.deb) installers
- Built artifacts are attached to a GitHub Release automatically
- The running app checks for updates on launch and periodically, shows "A new update is available" banner
- User can click "Download" to download and "Install & Restart" to apply
- Code signing is optional (skipped if no certs) — unsigned builds work

## User Stories

### US-C01: GitHub Actions release workflow
**Description:** As a developer, I want a GitHub Actions workflow that builds and publishes release artifacts when I push a version tag.

**Acceptance Criteria:**
- [ ] New file `.github/workflows/release.yml`
- [ ] Triggers on push of tags matching `v*.*.*` (e.g., `v1.0.0`, `v0.2.0-beta.1`)
- [ ] Runs on a matrix of `windows-latest`, `ubuntu-latest`, `macos-latest`
- [ ] Steps: checkout → setup Node 22 → npm ci → npm run test (vitest only, skip e2e) → npm run build:win/build:linux/build:mac (platform-appropriate)
- [ ] On Windows runner: runs `npm run build:win`, uploads `.exe` installer artifact
- [ ] On Linux runner: runs `npm run build:linux`, uploads `.AppImage` and `.deb` artifacts
- [ ] On macOS runner: runs `npm run build:mac`, uploads `.dmg` artifact
- [ ] After all matrix jobs succeed, creates a GitHub Release with tag name as title, attaches all artifacts, and generates release notes from commits
- [ ] The `download:octave` step is included in the build scripts (already wired in package.json)
- [ ] Code signing env vars (`CSC_LINK`, `CSC_KEY_PASSWORD`) are read from GitHub Secrets but builds succeed without them (unsigned)
- [ ] Typecheck passes

### US-C02: GitHub Actions CI workflow for PRs
**Description:** As a developer, I want automated tests running on every push and PR so regressions are caught before merge.

**Acceptance Criteria:**
- [ ] New file `.github/workflows/ci.yml`
- [ ] Triggers on push to any branch and pull_request to main
- [ ] Runs on `windows-latest` (primary platform)
- [ ] Steps: checkout → setup Node 22 → npm ci → npx tsc --noEmit → npx vitest run
- [ ] Fails the PR check if typecheck or tests fail
- [ ] Does NOT build installers (too slow for PRs)
- [ ] Typecheck passes

### US-C03: Wire updateBridge into app startup
**Description:** As a developer, I want the auto-update bridge initialized on app startup so it checks for updates automatically.

**Acceptance Criteria:**
- [ ] In `src/main/index.ts`, after `createWindow()`, call `initializeAutoUpdater()` (or equivalent) from `updateBridge.ts`
- [ ] The updater checks for updates on startup after a short delay (e.g., 10 seconds)
- [ ] The updater checks periodically (every 24 hours by default, configurable)
- [ ] Update status events are forwarded to the renderer via `mainWindow.webContents.send('update:status', status)`
- [ ] The updater does NOT auto-download — it notifies the user first
- [ ] If no update is available or check fails, nothing visible happens (silent)
- [ ] Typecheck passes
- [ ] All tests pass

### US-C04: Update banner UI in renderer
**Description:** As a user, I want to see a non-intrusive banner when a new version is available so I can choose to update.

**Acceptance Criteria:**
- [ ] New or updated component `src/renderer/editor/UpdateBanner.tsx` (check if one already exists)
- [ ] Banner appears at the top of the app when update status is 'available' or 'downloaded'
- [ ] Banner shows: "MatSlop v{version} is available" with action buttons
- [ ] When status is 'available': shows "Download" button that triggers download
- [ ] When status is 'downloading': shows progress bar with percentage
- [ ] When status is 'downloaded': shows "Install & Restart" button
- [ ] Banner can be dismissed (user can ignore the update)
- [ ] Banner uses app's CSS variables for theming (works in dark and light)
- [ ] The banner listens for `update:status` IPC events from the main process
- [ ] Clicking "Install & Restart" calls `window.matslop.updateInstall()` which triggers `quitAndInstall()`
- [ ] Typecheck passes

### US-C05: Add update IPC bridge methods
**Description:** As a developer, I need IPC methods for the renderer to trigger update actions (check, download, install).

**Acceptance Criteria:**
- [ ] Preload script exposes `window.matslop.updateCheck()` — triggers a manual update check
- [ ] Preload script exposes `window.matslop.updateDownload()` — starts downloading the available update
- [ ] Preload script exposes `window.matslop.updateInstall()` — quits and installs the downloaded update
- [ ] Preload script exposes `window.matslop.onUpdateStatus(callback)` — registers a listener for update status changes, returns an unsubscribe function
- [ ] Main process handles these IPC calls by delegating to the UpdateBridge
- [ ] Typecheck passes
- [ ] All tests pass

### US-C06: Add update menu items
**Description:** As a user, I want a "Check for Updates" menu item in the Help menu.

**Acceptance Criteria:**
- [ ] Help menu has "Check for Updates..." item
- [ ] Clicking it triggers a manual update check via `updateBridge.checkNow()`
- [ ] If an update is found, the update banner appears
- [ ] If no update is available, a dialog says "You're up to date (v{current})"
- [ ] Typecheck passes

### US-C07: Verify publish config matches GitHub repo
**Description:** As a developer, I need the electron-builder publish config to match the actual GitHub repository so auto-update can find releases.

**Acceptance Criteria:**
- [ ] `package.json` `build.publish` has `provider: "github"` with correct `owner` and `repo` matching the actual GitHub repository
- [ ] Check the current values: `"owner": "matslop", "repo": "matslop"` — update if the actual repo is different (e.g., `"owner": "Rising-Edge-Systems", "repo": "MatSlop"`)
- [ ] The `repository` field in package.json points to the correct GitHub URL
- [ ] Typecheck passes

### US-C08: Version bump script
**Description:** As a developer, I want a simple way to bump the version and create a release tag.

**Acceptance Criteria:**
- [ ] New npm script `version:patch` that runs `npm version patch && git push && git push --tags`
- [ ] New npm script `version:minor` that runs `npm version minor && git push && git push --tags`
- [ ] New npm script `version:major` that runs `npm version major && git push && git push --tags`
- [ ] Running `npm run version:patch` bumps 0.1.0 → 0.1.1, commits, tags as v0.1.1, and pushes
- [ ] The tag push triggers the release workflow from US-C01
- [ ] Documented in a brief section in the project README or a RELEASING.md file

## Functional Requirements

- FR-1: Pushing a tag `v*.*.*` triggers GitHub Actions to build Windows, macOS, and Linux installers
- FR-2: Built installers are published as GitHub Release artifacts
- FR-3: Every push/PR runs typecheck and unit tests via GitHub Actions
- FR-4: The app checks for updates on startup and every 24 hours
- FR-5: When an update is available, a banner appears with download/install options
- FR-6: The user can dismiss the banner or download and install
- FR-7: "Check for Updates" is available in the Help menu
- FR-8: Version bumping is a single npm command that triggers the full release pipeline

## Non-Goals

- No code signing certificates for now (unsigned builds, SmartScreen warning accepted)
- No beta/stable channel split
- No delta updates (full download each time)
- No auto-install without user consent
- No macOS notarization (requires Apple Developer account)

## Technical Considerations

- `electron-updater` v6.8.3 is already installed and `updateBridge.ts` has the full update lifecycle implemented
- electron-builder is configured with GitHub Releases as the publish provider
- The `download:octave` script must run before `electron-builder` — it downloads ~200MB of Octave binaries per platform
- GitHub Actions runners have limited disk space; the macOS and Linux Octave downloads are large
- The publish config in package.json must match the actual GitHub repo owner/name
- `app-update.yml` is auto-generated by electron-builder during build — not checked into git
- For private repos, `electron-updater` needs a GitHub token to check releases; for public repos it works without auth

## Success Metrics

- Developer can release a new version by running `npm run version:patch` — no manual steps
- Users see the update banner within 24 hours of a new release
- All three platform installers build successfully in CI
- PR checks catch test failures before merge
