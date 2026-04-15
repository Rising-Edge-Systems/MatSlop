# Releasing MatSlop

## Quick Release

To create a new release, run one of the following commands from the `main` branch:

```bash
# Patch release (0.1.0 → 0.1.1) — bug fixes
npm run version:patch

# Minor release (0.1.0 → 0.2.0) — new features
npm run version:minor

# Major release (0.1.0 → 1.0.0) — breaking changes
npm run version:major
```

## What Happens

1. `npm version` updates the version in `package.json`, creates a git commit, and tags it (e.g., `v0.1.1`).
2. The script pushes the commit and tag to GitHub.
3. The tag push triggers the **release workflow** (`.github/workflows/release.yml`).
4. GitHub Actions builds installers for Windows (`.exe`), macOS (`.dmg`), and Linux (`.AppImage`, `.deb`).
5. A GitHub Release is created automatically with the built artifacts attached.

## Monitoring

- Watch the build progress in the [Actions tab](https://github.com/Rising-Edge-Systems/MatSlop/actions).
- Once complete, the release appears on the [Releases page](https://github.com/Rising-Edge-Systems/MatSlop/releases).
- Users with MatSlop installed will see an in-app update banner on their next launch.

## Pre-release Checklist

- [ ] All tests pass (`npm test`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] You are on the `main` branch with a clean working tree
- [ ] The version bump makes sense (patch vs. minor vs. major)
