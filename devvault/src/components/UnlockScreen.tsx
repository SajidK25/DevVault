import { useState } from "react";
import { unlock } from "../lib/ipc";

export default function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pw);
      onUnlocked();
    } catch (err) {
      // Backend enforces the post-5-failures delay; surface its message.
      setError(String(err));
      setPw("");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-8 shadow-xl"
      >
        <h1 className="text-xl font-semibold">Unlock DevVault</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Enter your master password.
        </p>

        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Master password"
          className="mt-6 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
        />

        {error && (
          <p className="mt-4 rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!pw || busy}
          className="mt-6 w-full rounded-md bg-sky-600 py-2 font-medium transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
