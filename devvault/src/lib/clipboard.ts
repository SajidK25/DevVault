// Copy a secret to the clipboard and auto-clear it after 30s (spec §5).
// We only wipe if the clipboard still holds what we wrote, so we don't clobber
// something the user copied in the meantime. If reading is blocked, we clear
// anyway — erring on the side of not leaving secrets around.

const CLEAR_AFTER_MS = 30_000;

export async function copyWithAutoClear(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === value) await navigator.clipboard.writeText("");
    } catch {
      try {
        await navigator.clipboard.writeText("");
      } catch {
        /* clipboard unavailable; nothing we can do */
      }
    }
  }, CLEAR_AFTER_MS);
}

export const CLIPBOARD_CLEAR_SECONDS = CLEAR_AFTER_MS / 1000;
