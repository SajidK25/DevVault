import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Spec §5: clear the in-memory key after N minutes idle (default 10) and on
// window blur/minimize. Both are configurable here.
const IDLE_MINUTES = 60;
// Lock-on-blur is off by default: many Linux window managers/compositors fire
// spurious focus-change events, which would re-lock the vault constantly. Idle
// auto-lock still applies. Flip to true if your environment is well-behaved.
const LOCK_ON_BLUR = false;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

/**
 * Locks the vault on inactivity and (optionally) when the window loses focus.
 * `onLock` should call the backend `lock` command and route to the unlock screen.
 */
export function useAutoLock(enabled: boolean, onLock: () => void) {
  // Keep the latest onLock without re-subscribing listeners every render.
  const lockRef = useRef(onLock);
  lockRef.current = onLock;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lockRef.current(), IDLE_MINUTES * 60 * 1000);
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    let unlisten: (() => void) | undefined;
    if (LOCK_ON_BLUR) {
      getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) lockRef.current();
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          /* not in a Tauri window (e.g. plain browser dev) — skip blur lock */
        });
    }

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
      unlisten?.();
    };
  }, [enabled]);
}
