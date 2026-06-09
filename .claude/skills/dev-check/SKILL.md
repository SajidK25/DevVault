---
name: dev-check
description: Run DevVault's backend tests and frontend typecheck/build, reporting pass/fail. Use to verify changes before considering work done.
---

Verify the DevVault codebase. Rust isn't on the default PATH, so source it first.

1. Backend tests:
   ```
   . "$HOME/.cargo/env" && cd devvault/src-tauri && cargo test
   ```
2. Frontend typecheck + bundle:
   ```
   cd devvault && npm run build
   ```

Report which step passed or failed, with the relevant output. Both must pass for the change to count as verified. Do not launch the app or run a release build unless explicitly asked.
