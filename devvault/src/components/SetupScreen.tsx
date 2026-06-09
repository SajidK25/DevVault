import { useMemo, useState } from "react";
import { setupMaster, unlock } from "../lib/ipc";
import { estimateStrength } from "../lib/strength";

const MIN_LEN = 8;
const barColors = [
  "bg-red-600",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
];

export default function SetupScreen({ onReady }: { onReady: () => void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(() => estimateStrength(pw), [pw]);
  const tooShort = pw.length > 0 && pw.length < MIN_LEN;
  const mismatch = confirm.length > 0 && confirm !== pw;
  const canSubmit =
    pw.length >= MIN_LEN && pw === confirm && !busy && strength.score >= 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await setupMaster(pw);
      await unlock(pw); // unlock immediately so the user lands inside the vault
      onReady();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 p-8 shadow-xl"
      >
        <h1 className="text-xl font-semibold">Create your vault</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Set a master password. It is never stored and cannot be recovered —
          if you forget it, your data is gone by design.
        </p>

        <label className="mt-6 block text-sm font-medium">Master password</label>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
        />

        {pw.length > 0 && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
              <div
                className={`h-full transition-all ${barColors[strength.score]}`}
                style={{ width: `${(strength.score / 4) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{strength.label}</p>
          </div>
        )}
        {tooShort && (
          <p className="mt-1 text-xs text-red-400">
            At least {MIN_LEN} characters.
          </p>
        )}

        <label className="mt-4 block text-sm font-medium">
          Confirm password
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
        />
        {mismatch && (
          <p className="mt-1 text-xs text-red-400">Passwords don't match.</p>
        )}

        {error && (
          <p className="mt-4 rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-6 w-full rounded-md bg-sky-600 py-2 font-medium transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create vault"}
        </button>
      </form>
    </div>
  );
}
