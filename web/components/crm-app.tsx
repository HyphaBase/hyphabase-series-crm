"use client";

import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { Customers } from "./customers";
import { SignIn } from "./sign-in";

type State = { step: "loading" } | { step: "signed-out"; notice?: string } | { step: "signed-in"; me: Me } | { step: "failed"; message: string };

export function CrmApp() {
  const [state, setState] = useState<State>({ step: "loading" });

  async function load(notice?: string) {
    try {
      const me = await api.me();
      setState(me ? { step: "signed-in", me } : { step: "signed-out", notice });
    } catch (error) {
      setState({ step: "failed", message: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function signOut() {
    await api.signOut().catch(() => {});
    setState({ step: "signed-out" });
  }

  if (state.step === "loading") return <main className="center muted">Loading…</main>;

  if (state.step === "failed") {
    return (
      <main className="center">
        <div className="card notice-card">
          <p className="error" role="alert">{state.message}</p>
          <button className="button" onClick={() => { setState({ step: "loading" }); void load(); }}>Try again</button>
        </div>
      </main>
    );
  }

  if (state.step === "signed-out") return <SignIn notice={state.notice} onSignedIn={() => load()} />;

  const { user, permissions } = state.me;
  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">B</span>Brightside CRM</div>
        <div className="who">
          <span className="who-name">{user.name}</span>
          <button className="button ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="page">
        <Customers permissions={permissions} onSessionEnded={() => setState({ step: "signed-out", notice: "Your session ended. Sign in again." })} />
      </main>
    </>
  );
}
