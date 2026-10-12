---
status: accepted
---

# A Case Script file is YAML; there is no separate Flow model

People write, review, and keep Case Scripts in repos, so the import and export format has to be readable and diffable. `.yoqa.json` was noisy and required internal fields, and the Inspector's `yoqa` shell text could not become a Case Script without losing steps. We made YAML (`*.yoqa.yaml`) the default import and export format. It is only another way of writing the existing Case Script: the catalog still stores the same model, and Runs still replay it through the Case executor.

- **One model, one vocabulary.** Each action is a one-key map named after the existing Case Script action (`- tap: Home`, `- wait: 500`). There is no second schema to keep in sync, and the file can hold nothing the catalog can't.
- **Legacy files still load.** A file with `savedAt` is read as a legacy `.yoqa.json` export, whose actions carry `type`. JSON is valid YAML, so one parser reads both.
- **Shell is a one-way export.** You can paste or open shell in the Inspector to convert it once, but a shell script is not a Case Script file.

## Considered options

- **A separate Argent-style "Flow" schema and executor** (`yoqa flow run`, `domains/flows/`): rejected. It would duplicate the Case Script schema and add a fourth replay path. "Flow" already names a catalog concept (a reusable natural-language step).
- **`.yoqa/flows/` in the project as the primary store:** rejected for now. The desktop app has no project directory, and the catalog stays the source of truth. Files are for interchange.
- **Directive-style `type:` items** (`- type: tap`): rejected. They are harder to scan, and a bare `type: alert` would mean both "an alert" and "type the word alert".

## Consequences

- YAML comments are kept in a file and in the Inspector's editor, but not once a Case Script is saved to the catalog. The catalog still stores JSON.
- The canonical exporter writes one action per line, so a diff shows one changed action as one changed line.
