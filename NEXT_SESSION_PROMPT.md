# MatSlop — Next Session Prompt

Copy everything below the line and paste it as your first message to a new Claude Code session in this project directory.

---

## Context

MatSlop is an open-source MATLAB alternative built as an Electron app wrapping GNU Octave. It's at 139 commits on `main`, pushed to `origin/main` at `d97fcb2`. The codebase has 586 passing unit tests, typecheck clean, lint clean. The project has a working autonomous agent loop (`scripts/ralph/ralph.sh`) that can execute PRDs written to `scripts/ralph/prd.json`.

A previous session completed:
- 42 roadmap feature stories (US-001 through US-042)
- 6 polish cycles (28 stories) fixing layout, theming, and UX bugs
- ~10 manual hotfixes for rc-dock stale-content issues, workspace refresh races, Run button wiring, and command window state preservation
- End-to-end validation with a real Octave 8.4 install (extracted from apt debs into `/tmp/octave-root/octave-cli-wrap`)

The file `KNOWN_LIMITATIONS.md` documents every known issue. The file `scripts/screen-control.py` is a python-xlib tool for taking screenshots, clicking, and typing into the running app on DISPLAY=:1. **You must use screen-control.py to visually validate your work** — do not just trust that tests pass; launch the app and look at it.

## Your task

Fix every issue in `KNOWN_LIMITATIONS.md`, then validate each fix by launching the app and exercising the feature with `screen-control.py`. When all limitations are resolved, do a comprehensive end-to-end walkthrough of the entire app (similar to what a new user would do on first launch). Here is the full workflow:

### Phase 1: Fix known limitations

Read `KNOWN_LIMITATIONS.md` and fix each issue. Use the ralph loop (`scripts/ralph/ralph.sh --tool claude`) for batches of related fixes, or fix them directly for surgical changes. Key issues to address:

1. **Workspace first-refresh hang** — The first `octaveExecute('whos')` after launch hangs in OctaveProcessManager. Root cause is a race in the init-handshake command queue drain. A `setImmediate(processQueue)` fix was attempted but is insufficient. The workaround (2s watchdog + 1.5s timeout race) masks the bug. Find and fix the actual race condition so whos resolves on the first call every time.

2. **Busy indicator disabled** — `octaveBusyTracker` was implemented but its monkey-patch of `window.matslop.octaveExecute` conflicts with Electron's frozen contextBridge. The solution is to use the `OctaveContext` (React Context, already created in `src/renderer/OctaveContext.tsx`) pattern: have each caller of `octaveExecute` call `octaveBusyTracker.begin()/end()` manually, or move the tracking into the preload script where the IPC bridge is defined (before contextBridge freezes it). The status bar already reads `octaveBusyState` from the tracker — it just never gets driven.

3. **rc-dock stale closures** — Components inside rc-dock panels receive stale props because rc-dock's `loadTab` caches React elements. The current workaround uses `contentVersion` to force layout rebuilds, but that destroys component state (command window history, editor tabs). The correct fix is one of: (a) React Portals — render each panel's content into a portal targeting the rc-dock pane's DOM node, so React manages updates independently of rc-dock's lifecycle; (b) move ALL dynamic state into React Context (like `OctaveContext`) so dock-hosted components read from context instead of props; (c) use `rc-dock`'s `updateTab` API to push new content without rebuilding the layout.

4. **Debugger not live-verified** — Set breakpoints in a real .m file, hit them, step through, inspect the call stack and watches panels. Fix anything that doesn't work.

5. **Session restore not verified** — Close and reopen the app. Verify open tabs, cursor positions, and layout are restored. Fix if broken.

6. **Plotting pipeline not verified** — Install Octave properly (`sudo apt install octave` if you have sudo, or use the existing `/tmp/octave-root` setup and fix the fontconfig issue). Run `plot(1:10)`, `surf(peaks)`, verify figures appear in the Figure panel or via PlotRenderer. Fix the Plotly.js integration if it doesn't render.

7. **Linux Octave bundling** — Find a working AppImage source or switch to a different bundling strategy for Linux.

### Phase 2: Visual validation

After fixing, launch the app and use `scripts/screen-control.py` to exercise every major workflow. Take a screenshot after each step. Specifically:

1. Launch app — verify dark theme, all panels visible, Run button enabled
2. Click Run on the welcome script — verify output in Command Window
3. Type `x = magic(5)` in Command Window — verify workspace updates
4. Type `help sin` — verify Help panel opens with content
5. Open File Browser, navigate to a folder, create a new .m file
6. Write a script with a loop, run it, verify output
7. Create a plot (`plot(1:10)`), verify it renders
8. Set a breakpoint, run to it, verify debugger UI activates
9. Close and reopen app — verify session restore
10. Resize panels via drag — verify layout persists

### Phase 3: Final polish

Fix any issues found during Phase 2. Run the full test suite (`npm test`), typecheck (`npm run typecheck`), commit, and push.

### How to use the tools

- **Ralph loop**: Write a PRD to `scripts/ralph/prd.json`, then run `./scripts/ralph/ralph.sh --tool claude 15`. Ralph spawns one Claude instance per story in a new terminal window.
- **Screen control**: `python3 scripts/screen-control.py screenshot /tmp/shot.png`, `python3 scripts/screen-control.py click <x> <y>`, etc. The app runs on DISPLAY=:1.
- **CDP debugging**: Launch with `npx electron-vite dev -- --no-sandbox "--remote-debugging-port=9222" "--remote-allow-origins=*"` to get Chrome DevTools Protocol access at `http://localhost:9222`.
- **Octave**: Configured at `/tmp/octave-root/octave-cli-wrap` (extracted apt debs). Config stored in `~/.config/matslop/config.json`. If octave isn't found, check that file.
- **Session reset**: Delete `~/.config/matslop/session.json` before launch for a clean first-run experience.

### Critical lessons from the previous session

1. **Always visually validate with screen-control.py.** The previous session spent hours debugging IPC races that would have been caught in 30 seconds by looking at the screen.
2. **rc-dock caches everything.** Any prop change to a component inside a dock panel is silently dropped unless you use Context, Portals, or updateTab. `contentVersion` rebuilds destroy state — don't use it for frequently-changing values.
3. **Electron's contextBridge freezes objects.** You cannot reassign or Object.defineProperty on `window.matslop` or its children from the renderer. Use preload-side wrapping or React Context instead.
4. **Test with real Octave, not mocks.** The process manager has timing-dependent bugs that only manifest with a real Octave subprocess.
5. **Run the script multiple times.** Single-run tests miss state accumulation bugs (duplicate output, shrinking text, stale closures).
