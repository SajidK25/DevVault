import { useCallback, useEffect, useState } from "react";
import { lock, vaultStatus } from "./lib/ipc";
import { useAutoLock } from "./hooks/useAutoLock";
import { useTheme } from "./hooks/useTheme";
import SetupScreen from "./components/SetupScreen";
import UnlockScreen from "./components/UnlockScreen";
import VaultHome from "./components/VaultHome";

type Screen = "loading" | "setup" | "unlock" | "vault";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [theme, toggleTheme] = useTheme();

  const refresh = useCallback(async () => {
    const status = await vaultStatus();
    if (!status.is_setup) setScreen("setup");
    else if (status.is_unlocked) setScreen("vault");
    else setScreen("unlock");
  }, []);

  useEffect(() => {
    refresh().catch(() => setScreen("unlock"));
  }, [refresh]);

  const handleLock = useCallback(async () => {
    await lock();
    setScreen("unlock");
  }, []);

  // Auto-lock on idle / window blur whenever the vault is open.
  useAutoLock(screen === "vault", handleLock);

  if (screen === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-500">
        Loading…
      </div>
    );
  }

  if (screen === "setup") return <SetupScreen onReady={() => setScreen("vault")} />;
  if (screen === "unlock")
    return <UnlockScreen onUnlocked={() => setScreen("vault")} />;

  return <VaultHome onLock={handleLock} theme={theme} onToggleTheme={toggleTheme} />;
}
