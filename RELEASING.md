# Releasing MatSlop

## Quick Release

```bash
npm run version:patch    # 0.2.0 → 0.2.1 (bug fixes)
npm run version:minor    # 0.2.0 → 0.3.0 (new features)
npm run version:major    # 0.2.0 → 1.0.0 (breaking changes)
```

## What Happens

1. `npm version` bumps `package.json`, commits, and creates a git tag (e.g., `v0.2.1`)
2. The script pushes the commit and tag to GitHub
3. CI runs tests, then builds Windows (.exe), macOS (.dmg + .zip), and Linux (.AppImage, .deb) installers
4. `electron-builder --publish onTag` creates a GitHub Release and uploads all artifacts automatically
5. Users with MatSlop installed see an in-app update notification

## How It Works

A single workflow (`.github/workflows/ci.yml`) handles everything:
- **Push to any branch / PR**: runs tests only
- **Push a tag `v*.*.*`**: runs tests, builds all platforms, publishes to GitHub Releases

electron-builder handles release creation and artifact upload via `--publish onTag` with the GitHub provider. No separate release workflow needed.

## Auto-Update

- **Windows/Linux**: in-app "Install & Restart" applies the update automatically
- **macOS**: unsigned apps can't auto-install; the button opens the release page to download the new DMG

## Pre-release Checklist

- [ ] All tests pass (`npm test`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] On `main` branch with clean working tree
