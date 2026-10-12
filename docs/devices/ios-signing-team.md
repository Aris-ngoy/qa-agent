# iOS signing team: one setting for the desktop and the CLI

## Goal

A cabled iPhone only runs `YoqaRunner` once it is signed for one Apple team (see [yoqa-runner-status.md](./yoqa-runner-status.md)). The team was the newest Apple Development certificate in the keychain, overridable only with `YOQA_IOS_TEAM_ID` in the runner's environment. On a second Mac, or with several teams, the only fix the error offered was "set YOQA_IOS_TEAM_ID". The goal: choose the team, see which teams a Mac can sign with, and check that a team can sign for a phone, from both the desktop and the CLI.

## Plan summary

- **The runner owns the setting.** It is saved in `~/.yoqa/ios-signing.json` (`{ "team": "…" }`) and served over HTTP, so the desktop and the CLI read and write the same value. Rejected: keeping it in the desktop's settings file. The desktop's old "Code Signing Identity" picker was stored there and never reached the runner, so the CLI could not see it.
- **Precedence:** `YOQA_IOS_TEAM_ID` → saved team → the team of the newest Apple Development certificate. The environment variable stays the highest, for CI and scripts, and both clients say when it overrides the saved team.
- **Teams come from two places.** The keychain (certificate OU, and the newest certificate per team) and Xcode › Settings › Accounts (`IDEProvisioningTeamByIdentifier` in Xcode's defaults: team name and `isFreeProvisioningTeam`). A team signed in to Xcode with no certificate on this Mac yet is still usable; Xcode makes the certificate on the first build. The team ID is the certificate's OU, not the ID in parentheses in its name. The old desktop scan used that ID as a fallback, and a skill doc told agents to.
- **A check is a real signed build.** `checkIosSigning` runs the same `prepareYoqaRunner` a session does (build or reuse, without launching). It registers the phone and refreshes a 7-day profile on the way. A signing failure is an answer (`ok: false` plus the fix), not an HTTP error. Rejected: a dry check from local profiles alone, since it cannot tell whether Xcode can register the phone.
- `prepareYoqaRunner` now runs one build at a time, so a check and a session never share a derived-data path.

## What shipped

- **Runner:** [`ios-signing.ts`](../../services/runner/src/domains/devices/ios-signing.ts) (`getIosSigning`, `setIosSigningTeam`, `checkIosSigning`). [`yoqa-runner.ts`](../../services/runner/src/domains/devices/yoqa-runner.ts) gains `resolveSigningTeam` (with its source), the saved team, `profileExpiresAt` / `devices` on every build, serialized builds, and error fixes that point to Settings › iOS and `yoqa signing use` instead of only `YOQA_IOS_TEAM_ID`.
- **HTTP:** `GET /ios/signing`, `PUT /ios/signing { team | null }` (400 for a malformed team ID), `POST /ios/signing/check { deviceId }`. The schemas are in `@yoqa/runner-client` (`iosSigningStatusSchema`, `iosSigningCheckResponseSchema`, …), with the client methods `getIosSigning`, `setIosSigningTeam` and `checkIosSigning`.
- **CLI:** `yoqa signing` (status), `yoqa signing use <team|auto>`, and `yoqa signing check [--device <udid>]`, which defaults to the one cabled iPhone and exits 1 with the fix. All three take `--json`. A runner that answered with an error no longer gets the "Is the runner up?" hint.
- **Desktop:** Settings › iOS has a **Signing team** card ([`ios-signing-card.tsx`](../../apps/desktop/src/mainview/features/settings/ios-signing-card.tsx)). It offers Automatic or a team (with Personal/Paid badge, whether it is in Xcode, and certificate expiry), a notice when `YOQA_IOS_TEAM_ID` overrides it, the App ID, and **Check** per cabled iPhone. The desktop's keychain scan and `signingIdentityHash` preference are gone, and so is the unused `settings-modal.tsx`.
- **Skill:** `references/devices.md` documents `yoqa signing`, and `builds-ios-native.md` no longer says the team ID is in a certificate's name.

## How to verify

1. `bun test services/runner/src/domains/devices packages/cli/src/signing.test.ts`
2. With a runner up: `yoqa signing` lists the Mac's teams and marks the one in use with its source.
3. `yoqa signing use <TeamID>`. The desktop's Settings › iOS shows the same team, and `~/.yoqa/ios-signing.json` holds it. `yoqa signing use auto` removes the file.
4. Cable and unlock an iPhone, then run `yoqa signing check`, or press **Check** in the desktop. The result says the team can sign for it and when the profile expires. With a team Xcode has no account for, it fails with "Xcode has no account for team …" and exits 1.
5. Start the runner with `YOQA_IOS_TEAM_ID=…`. `yoqa signing` and the desktop say it overrides the saved team.

## Follow-ups

- The desktop's Xcode picker is still stored only in the desktop's settings and does not reach the runner's `xcodebuild` (`DEVELOPER_DIR`). It is the same gap the signing picker had, and it needs the same move to the runner.
- When the `--watch` dev runner restarts, it leaves the old session's `xcodebuild test-without-building` running on the phone.
