# Yoqa

Local-first agentic mobile QA: devices under Appium, runs driven by scripts or the Yoqa agent, BYO providers for vision and decide.

## Language

### Device layer

**Device Session**:
A live connection to one device (or simulator/emulator) through its Control path, including gestures, screenshots, and app lifecycle control. At most one Device Session may exist per device id at a time.
_Avoid_: Active session handle alone, WebDriver session (implementation detail), runner session

**Control path**:
How a Device Session drives one kind of device: its Helpers plus the platform tooling around them. There is exactly one per kind of device (iOS simulator, physical iPhone, Android), so nothing is selected per session. The Run report names the Control path that ran and the Device capabilities in use.
_Avoid_: Lane (retired), backend (runner / cloud), driver (Provider drivers), transport

**Helper**:
A native process the runner starts and talks to on behalf of one device: the sim server, the AX service, the phone helper, or the Android helper. A Helper that stops answering ends its Device Session.
_Avoid_: runner (the Yoqa host process), agent (the Yoqa agent), daemon

**Device capability**:
Something a device's Control path can do on that device right now (for example reading the accessibility tree, or streaming frames). A Tool that needs a missing Device capability fails and names it; it never falls back to another path.
_Avoid_: capability alone (once meant Appium capabilities), feature

**Launch settings**:
First-class App or Case settings for how the app under test is started (whether it auto-launches, which activity to launch and wait for). They replace Appium capabilities.
_Avoid_: capabilities, caps, desired capabilities

**Lane**:
_Retired in v2, replaced by Control path._ The control path a Device Session uses to drive its device: the _Appium lane_ (through the Appium Server) or a _Direct lane_ (straight to the platform tooling, bypassing Appium, for speed). Android auto-picks Direct over adb when there are no custom capabilities; iOS simulators auto-pick Direct over idb_companion when the official binary is present (physical iOS stays Appium). A Device Session has exactly one Lane for its whole life. A Case or App that sets custom Appium capabilities always gets the Appium lane. The Run report names the Lane that ran.
_Avoid_: driver (Provider drivers), backend (runner / cloud), transport, engine

**Active Session**:
The single Device Session shared across modes (connector / inspector / runs). A Run adopts it when it targets the same device and holds it view-only until the run finishes; it stays live until the user disconnects or connects another device.
_Avoid_: Run session (a Run adopts the Active Session), per-mode session

**Dead Session**:
A Device Session the runner still thinks is open but whose Control path is gone: a Helper exited, its connection dropped, or the device disconnected.
_Avoid_: disconnected (user-initiated), abandoned (implementation verb only)

**Appium Runtime**:
The installed Appium binary and drivers Yoqa manages under its home directory.
_Avoid_: Appium server (the listening process), Device Session

**Appium Server**:
The listening Appium process Device Sessions attach to.
_Avoid_: Appium Runtime, WebDriver hub (generic)

### Screen & action

**Screen**:
A reading of the device UI for agents: cleaned element tree with relative coordinates 0–1000, or the raw accessibility tree when full fidelity is requested. On the Android Direct lane the tree is system-wide (permission sheets, ANR dialogs). On the iOS Direct lane the tree is idb axbridge complete, including a system `modal`. The built-in Run agent does not see a Screen unless the Run opts into tree Screen mode.
_Avoid_: page source (Appium term alone), DOM

**Screen mode**:
How a Run presents the device to the agent when it decides. _Vision_ (the default) shows only the screenshot with the instruction; the agent names points by x,y. _Tree_ (opt-in per Run) also attaches the Screen.
_Avoid_: perception mode, input mode

**Grid mode**:
A way of presenting the screenshot in which a labeled grid is drawn on it and the agent names a cell and a position inside it instead of raw x,y. A case starts in Grid mode for a game, and is escalated into it from Vision when taps keep having no visible effect, after a Tree assist has had its chance.
_Avoid_: game mode (games are one trigger, not the definition), overlay

**Escalation**:
The one-way, per-case switch from plain x,y to Grid mode after four consecutive x,y taps leave the screenshot unchanged. It is recorded on the step that triggered it.

**Tree assist**:
A Vision-mode step that also gets the Screen tree, because the two actions before it left the screenshot unchanged (waits aside). It lasts while the screen stays unchanged, is recorded as `treeAssist` on the step, and is not used for a known game. The screenshot stays the ground truth. On such a step a plain x,y tap is snapped onto the nearest tappable control within 100 units (`snappedTo` on the step).
_Avoid_: fallback (implies going back), retry

**Grounding**:
Mapping a natural-language element description to coordinates on the current Screen / screenshot.
_Avoid_: locator, find element (when meaning description→coords)

**Tool**:
One named operation on a device, defined once and reachable the same way from the CLI and from MCP. Some Tools only read (the Screen, a screenshot, the device list); the rest are Actions.
_Avoid_: command (CLI), endpoint, API call

**Action**:
A single device gesture or app-lifecycle command (tap, swipe, type, open URL, etc.), optionally grounded from a description. Each Action carries an Action id, so a retried Action whose reply was lost returns the first result instead of running twice.
_Avoid_: step (Run timeline), command (CLI)

**Settle**:
Waiting after an Action until the screenshot stops changing, bounded by a cap. An animating screen (typically a game) may never settle; the result then says it did not, and the latest frame is returned anyway.
_Avoid_: idle wait, sleep (a fixed delay is not a Settle)

**Result screenshot**:
The screenshot captured after an Action has settled, so the effect of that Action is seen without a separate capture. It is the raw device image and the stored ground truth (reports, assertions, replay). A connector caller is handed an Agent image of it by default; an annotated copy marks where the Action landed.
_Avoid_: post-action capture, verification screenshot

**Agent image**:
A reduced-size copy of a screenshot prepared for a model: what Decide sends to a Vision-capable Provider, and what a connector caller receives by default after an Action. Never the stored original; the raw frame is always kept.
_Avoid_: thumbnail, preview, compressed screenshot

### Providers

**Provider**:
A configured BYO backend for model auth, model listing, and (when capable) vision decide/ground.
_Avoid_: driver (implementation), LLM, model vendor alone

**Vision-capable Provider**:
A Provider that can decide the next Action or perform Grounding from a screenshot.
_Avoid_: any Provider with an API key

**Decide**:
A single vision completion by a Vision-capable Provider that maps the current screenshot and one instruction (plus the Screen, only in tree Screen mode) to the next Action.
_Avoid_: LLM call, inference, step (Run timeline)

**Prompt cache**:
A Provider's reuse of the unchanged leading part of a Decide or verify request across calls in the same Test Case, billed and served cheaper than fresh input.
_Avoid_: token cache (ambiguous with auth tokens), decision cache, response cache

**Call usage**:
The token accounting a Provider reports for one Decide or verify call: fresh input, Prompt cache reads, Prompt cache writes, and output.
_Avoid_: cost, tokens (alone), billing

### Catalog

**App Knowledge**:
A small, user-maintained notes document attached to one catalog app, available as decide context so recurring screens and flows are handled correctly.
_Avoid_: memory, learned context, app summary

### Runs

**Run**:
An execution of one or more Test Cases against a device, in script or agent mode.
_Avoid_: Job, job run, pipeline

**Run recording**:
An opt-in screen video of one Test Case within a Run, captured alongside its Result screenshots. A Test Case says whether it records (off by default); starting a Run can also ask to record every case. Evidence only: it is never shown to Decide and never takes part in Settle. It is playable only after the Run has finished. A Lane or device that cannot record leaves the Run unaffected and the case records why there is no video.
_Avoid_: screencast, clip, session recording

**Case executor**:
The module that runs one Test Case against a Device Session (script replay or agent loop), with abort, settle, and step recording injected at its seam.
_Avoid_: executeRun (orchestration + persistence around cases)

**Case Script**:
A saved, coords-based replay of Actions for a Test Case (no live decide).
_Avoid_: shell script (inspector/CLI step language), agent instructions
