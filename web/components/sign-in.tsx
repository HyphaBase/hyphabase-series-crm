"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

export function SignIn({ notice, onSignedIn }: { notice?: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signIn(email, password);
      onSignedIn();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand login-brand"><span className="brand-mark" aria-hidden="true">B</span>Brightside CRM</div>
        <h1>Sign in</h1>
        <p className="muted">Use your Brightside Cleaning account.</p>

        {notice && !error && <p className="notice">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <label className="field">
          <span>Email</span>
          <input type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        <button className="button primary wide" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
