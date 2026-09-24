# Yoqa

Local-first agentic mobile QA: devices under Appium, runs driven by scripts or the Yoqa agent, BYO providers for vision and decide.

## Language

### Device layer

**Device Session**:
A live connection to one device (or simulator/emulator) through Appium, including gestures, screenshots, and app lifecycle control. At most one Device Session may exist per device id at a time.
_Avoid_: Active session handle alone, WebDriver session (implementation detail), runner session

**Active Session**:
The single Device Session shared across modes (connector / inspector / runs). A Run adopts it when it targets the same device and holds it view-only until the run finishes; it stays live until the user disconnects or connects another device.
_Avoid_: Run session (a Run adopts the Active Session), per-mode session

**Dead Session**:
A Device Session the runner still thinks is open but Appium has already dropped (invalid/missing session id).
_Avoid_: disconnected (user-initiated), abandoned (implementation verb only)

**Appium Runtime**:
The installed Appium binary and drivers Yoqa manages under its home directory.
_Avoid_: Appium server (the listening process), Device Session

**Appium Server**:
The listening Appium process Device Sessions attach to.
_Avoid_: Appium Runtime, WebDriver hub (generic)

### Screen & action

**Screen**:
A reading of the device UI for agents: cleaned element tree with relative coordinates 0–1000, or the raw accessibility tree when full fidelity is requested.
_Avoid_: page source (Appium term alone), DOM

**Grounding**:
Mapping a natural-language element description to coordinates on the current Screen / screenshot.
_Avoid_: locator, find element (when meaning description→coords)

**Action**:
A single device gesture or app-lifecycle command (tap, swipe, type, open URL, etc.), optionally grounded from a description.
_Avoid_: step (Run timeline), command (CLI)

### Providers

**Provider**:
A configured BYO backend for model auth, model listing, and (when capable) vision decide/ground.
_Avoid_: driver (implementation), LLM, model vendor alone

**Vision-capable Provider**:
A Provider that can decide the next Action or perform Grounding from a screenshot.
_Avoid_: any Provider with an API key

### Runs

**Run**:
An execution of one or more Test Cases against a device, in script or agent mode.
_Avoid_: Job, job run, pipeline

**Case executor**:
The module that runs one Test Case against a Device Session (script replay or agent loop), with abort, settle, and step recording injected at its seam.
_Avoid_: executeRun (orchestration + persistence around cases)

**Case Script**:
A saved, coords-based replay of Actions for a Test Case (no live decide).
_Avoid_: shell script (inspector/CLI step language), agent instructions
