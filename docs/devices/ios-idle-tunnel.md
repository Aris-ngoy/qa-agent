# Cabled iPhone shown as "not connected"

## Goal

A paired iPhone on a cable was listed as unavailable ("On a cable but not connected. Unlock the iPhone and trust this Mac") even though it was unlocked, trusted and in Developer Mode.

## Plan summary

`xcrun devicectl list devices` reports `tunnelState: disconnected` for a wired phone until something talks to it; CoreDevice opens the tunnel on first use. Rejected: treating `disconnected` as connected (would pick phones that really are locked or untrusted). Chosen: wake idle phones, then re-list and judge the real state.

## What shipped

- `idleWiredUdids` in `services/runner/src/domains/devices/devicectl.ts` finds cabled, paired phones whose tunnel is down.
- `listIosPhysicalDevices` in `application.ts` runs `devicectl device info lockState --device <udid>` for each, re-reads the list, and only then applies the unavailable reasons. A locked or untrusted phone still fails the wake and keeps its message.

## How to verify

- `bun test services/runner/src/domains/devices/devicectl.test.ts`
- Plug in a paired iPhone, restart the runner, refresh devices: it shows `connected` without any manual `devicectl` call.

## Follow-ups

none
