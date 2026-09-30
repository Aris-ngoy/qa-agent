# Appium Runtime module

## Goal

Make “ready Appium Runtime” one module: status, ensure (install plus drivers), platform setup, physical iOS prep, and a listening Appium Server. Device Session only attaches. Doctor and HTTP stay callers.

## Plan summary

The seam is `createAppiumRuntime(host)`. Tests cross that interface. Host-process spawn, files, port checks, and the status probe are an internal seam (`RuntimeHost`): production uses the real process host, tests use a scripted host.

Rejected: folding Appium Server lifecycle into Device Session (ADR 0001). Rejected: a second readiness probe in Doctor. WebDriverAgent build steps stay in the iOS module and run on the same host, so prep reuse is visible from Runtime setup.

## What shipped

- `createAppiumRuntime` answers status, ensure, platform setup (including physical iOS WebDriverAgent reuse), `ensureServer`, and `readDevicePrep`.
- Device Session calls that module for the listen port and prep record.
- Appium Server list/stop/restart delegates to the production runtime, so there is one managed process.
- Install, driver list, and prep reads go through the host, so tests do not spawn Appium or Xcode.

## How to verify

```bash
bun test services/runner/src/domains/appium/runtime.test.ts
bun run test
bun run check
```

## Follow-ups

- Host PATH and Android SDK helpers stay as their own modules. Runtime tests do not cover that path math.
- Doctor still runs `appium driver doctor` with its own process spawn. Status and ensure already come from this module.
