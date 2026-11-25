"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { NOTE_LENGTH, type Customer, type Note } from "@/lib/customers";

type State = { step: "loading" } | { step: "ready"; notes: Note[] } | { step: "failed"; message: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The notes on one customer, newest first, and a box to add another for anyone whose role allows it. */
export function Notes({ customer, mayAdd, onClose, onSessionEnded }: { customer: Customer; mayAdd: boolean; onClose: () => void; onSessionEnded: () => void }) {
  const [state, setState] = useState<State>({ step: "loading" });
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.notes(customer.id).then(
      (notes) => current && setState({ step: "ready", notes }),
      (problem) => {
        if (!current) return;
        if (problem instanceof ApiError && problem.status === 401) return onSessionEnded();
        setState({ step: "failed", message: problem instanceof Error ? problem.message : "Something went wrong." });
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The note comes back with its author and its time, both filled in by HyphaBase.
      const note = await api.addNote(customer.id, content);
      setState((current) => (current.step === "ready" ? { step: "ready", notes: [note, ...current.notes] } : current));
      setContent("");
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) return onSessionEnded();
      setError(problem instanceof Error ? problem.message : "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <section className="card notes" aria-label={`Notes on ${customer.name}`}>
      <div className="notes-head">
        <h2>Notes on {customer.name}</h2>
        <button className="button ghost" onClick={onClose}>Close</button>
      </div>

      {mayAdd && (
        <form className="note-form" onSubmit={submit} noValidate>
          <textarea
            name="content"
            aria-label="New note"
            placeholder="Write a note"
            rows={2}
            maxLength={NOTE_LENGTH}
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Add note"}</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {state.step === "loading" && <p className="muted">Loading notes…</p>}
      {state.step === "failed" && <p className="error" role="alert">{state.message}</p>}
      {state.step === "ready" && state.notes.length === 0 && <p className="muted">No notes yet.</p>}
      {state.step === "ready" && state.notes.length > 0 && (
        <ul className="note-list">
          {state.notes.map((note) => (
            <li key={note.id} className="note">
              <p>{note.content}</p>
              <small className="muted">{note.author ?? "Someone"} · {when(note.created_at)}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
