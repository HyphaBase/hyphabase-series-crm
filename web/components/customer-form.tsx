"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { STATUSES, type Customer, type CustomerChanges, type CustomerErrors, type Status } from "@/lib/customers";

/** One form for both jobs: with a `customer` it edits that one, without it adds a new one. */
export function CustomerForm({ customer, onSaved, onCancel, onSessionEnded }: { customer?: Customer; onSaved: (customer: Customer) => void; onCancel: () => void; onSessionEnded: () => void }) {
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [status, setStatus] = useState<Status>(customer?.status ?? "lead");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<CustomerErrors>({});

  /** Only what the person changed is sent, so an edit cannot undo someone else's change to another field. */
  function changesTo(original: Customer): CustomerChanges {
    const changes: CustomerChanges = {};
    if (name.trim() !== original.name) changes.name = name;
    if (email.trim().toLowerCase() !== original.email) changes.email = email;
    if (phone.trim() !== (original.phone ?? "")) changes.phone = phone;
    if (status !== original.status) changes.status = status;
    return changes;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes = customer && changesTo(customer);
    if (changes && Object.keys(changes).length === 0) return onCancel();

    setBusy(true);
    setError(null);
    setErrors({});
    try {
      onSaved(customer ? await api.updateCustomer(customer.id, changes!) : await api.addCustomer({ name, email, phone, status }));
    } catch (problem) {
      if (problem instanceof ApiError && problem.status === 401) return onSessionEnded();
      if (problem instanceof ApiError) setErrors(problem.errors);
      setError(problem instanceof Error ? problem.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    // noValidate: the server's messages are the ones shown, so they are the same however the request is made.
    <form className="card add-form" onSubmit={submit} noValidate>
      <h2>{customer ? `Edit ${customer.name}` : "New customer"}</h2>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="grid">
        <label className="field">
          <span>Name</span>
          <input name="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
          {errors.name && <small className="field-error">{errors.name}</small>}
        </label>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} />
          {errors.email && <small className="field-error">{errors.email}</small>}
        </label>
        <label className="field">
          <span>Phone <em className="muted">optional</em></span>
          <input name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={Boolean(errors.phone)} />
          {errors.phone && <small className="field-error">{errors.phone}</small>}
        </label>
        <label className="field">
          <span>Status</span>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {errors.status && <small className="field-error">{errors.status}</small>}
        </label>
      </div>

      <div className="actions">
        <button type="button" className="button ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? "Saving…" : customer ? "Save changes" : "Save customer"}</button>
      </div>
    </form>
  );
}
