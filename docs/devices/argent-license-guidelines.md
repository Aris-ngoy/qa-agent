# Argent license guidelines (must not violate)

Source: [`LICENSE.txt`](https://github.com/software-mansion/argent/blob/main/LICENSE.txt) in `software-mansion/argent`.

Argent uses a mixed model. Follow it exactly.

## 1. What is allowed

- Depend on Argent source via npm: `npm install -g @swmansion/argent` or project-local `devDependencies` + `argent init`.
- Run the shipped `argent` CLI / MCP server / tool-server as-is.
- Reference Apache-2.0 source under its terms (keep copyright / license notices where required).

## 2. What is proprietary (do not touch)

These are Software Mansion S.A. IP, licensed solely for use within the Argent project:

- `packages/native-devtools-ios/bin/simulator-server`
- `packages/native-devtools-ios/bin/ax-service`
- `packages/native-devtools-ios/dylibs/libArgentInjectionBootstrap.dylib`
- `packages/native-devtools-ios/dylibs/libKeyboardPatch.dylib`
- `packages/native-devtools-ios/dylibs/libNativeDevtoolsIos.dylib`

## 3. Hard rules for this repo

- [ ] Never vendor, copy, or commit the binaries above into `qa-agent` (no `bin/`, no DMG payload, no checked-in `.dylib` / `simulator-server` / `ax-service`).
- [ ] Never decompile, reverse-engineer, or disassemble them.
- [ ] Never redistribute them outside Argent (no separate download, no re-hosted tarball, no `.tgz` in releases).
- [ ] Never patch `node_modules/@swmansion/argent` sources to work around the binaries.
- [ ] Install only via npm (`-g` global on user consent, or `--local` devDependency) so binaries stay inside the Argent package.
- [ ] Splash install prompt must name the global install + link here before the user accepts.
- [ ] Telemetry is opt-out: support `argent telemetry disable` / `--no-telemetry`; document it in setup copy.

## 4. How to verify

1. `git ls-files | rg -i 'simulator-server|ax-service|libArgent|libKeyboardPatch|libNativeDevtoolsIos'` returns nothing.
2. `rg -i 'simulator-server|ax-service|libNativeDevtools' --glob '!docs/**'` returns nothing vendored.
3. Install path in code/docs is only `npm install -g @swmansion/argent` / `argent init`, never a direct binary URL.
4. A fresh `git clone` + `npm install` contains no Argent binaries outside `node_modules`.

## 5. If in doubt

Stop and ask before copying any file out of the Argent package. Default answer is no.
