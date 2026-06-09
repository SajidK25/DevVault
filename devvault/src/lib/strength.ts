// Lightweight master-password strength estimator (no external deps).
// Returns a 0–4 score plus a label, good enough for a setup meter.

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function estimateStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "Empty" };

  let bits = 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  if (pool > 0) bits = Math.log2(pool) * pw.length;

  // Penalize trivial repetition / sequences crudely.
  if (/(.)\1{2,}/.test(pw)) bits -= 10;

  let score: Strength["score"];
  if (bits < 28) score = 0;
  else if (bits < 40) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 80) score = 3;
  else score = 4;

  const labels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
  return { score, label: labels[score] };
}
