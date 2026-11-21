"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Customer } from "@/lib/customers";
import { CAN } from "@/lib/permissions";
import { CustomerForm } from "./customer-form";

type List = { step: "loading" } | { step: "ready"; customers: Customer[] } | { step: "failed"; message: string };

/** What the form above the table is doing, if it is open. */
type Form = { job: "add" } | { job: "edit"; customer: Customer } | null;

export function Customers({ permissions, onSessionEnded }: { permissions: string[]; onSessionEnded: () => void }) {
  const [list, setList] = useState<List>({ step: "loading" });
  const [form, setForm] = useState<Form>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Hiding a button is a courtesy. The server checks the permission again on every request.
  const mayAdd = permissions.includes(CAN.addCustomers);
  const mayEdit = permissions.includes(CAN.updateCustomers);
  const mayDelete = permissions.includes(CAN.deleteCustomers);

  useEffect(() => {
    api.customers().then(
      (customers) => setList({ step: "ready", customers }),
      (error) => {
        if (error instanceof ApiError && error.status === 401) return onSessionEnded();
        setList({ step: "failed", message: error instanceof Error ? error.message : "Something went wrong." });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (customers: (current: Customer[]) => Customer[]) =>
    setList((current) => (current.step === "ready" ? { step: "ready", customers: customers(current.customers) } : current));

  function saved(customer: Customer) {
    change((customers) => (customers.some((c) => c.id === customer.id) ? customers.map((c) => (c.id === customer.id ? customer : c)) : [customer, ...customers]));
    setJustSaved(customer.id);
    setForm(null);
  }

  function open(next: Form) {
    setForm(next);
    setConfirming(null);
    setProblem(null);
  }

  async function remove(customer: Customer) {
    setDeleting(true);
    setProblem(null);
    try {
      await api.deleteCustomer(customer.id);
      change((customers) => customers.filter((c) => c.id !== customer.id));
      setForm((current) => (current?.job === "edit" && current.customer.id === customer.id ? null : current));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return onSessionEnded();
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
    }
    setConfirming(null);
    setDeleting(false);
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">
            {list.step === "ready" ? `${list.customers.length} ${list.customers.length === 1 ? "customer" : "customers"} in Portland` : "Portland"}
          </p>
        </div>
        {mayAdd && !form && <button className="button primary" onClick={() => open({ job: "add" })}>Add customer</button>}
      </div>

      {/* The key gives each customer a fresh form, so switching from one to another never shows the last one's values. */}
      {form && (
        <CustomerForm
          key={form.job === "edit" ? form.customer.id : "new"}
          customer={form.job === "edit" ? form.customer : undefined}
          onSaved={saved}
          onCancel={() => setForm(null)}
          onSessionEnded={onSessionEnded}
        />
      )}

      {problem && <p className="error list-error" role="alert">{problem}</p>}

      <div className="card table-card">
        {list.step === "loading" && <p className="empty muted">Loading customers…</p>}
        {list.step === "failed" && <p className="empty error" role="alert">{list.message}</p>}
        {list.step === "ready" && list.customers.length === 0 && <p className="empty muted">No customers yet.</p>}
        {list.step === "ready" && list.customers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>Status</th>
                {(mayEdit || mayDelete) && <th><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.customers.map((customer) => (
                <tr key={customer.id} className={customer.id === justSaved ? "fresh" : undefined}>
                  <td className="strong">{customer.name}</td>
                  <td>{customer.email}</td>
                  <td>{customer.phone ?? <span className="muted">—</span>}</td>
                  <td><span className={`badge ${customer.status}`}>{customer.status}</span></td>
                  {(mayEdit || mayDelete) && (
                    <td className="row-actions">
                      {confirming === customer.id ? (
                        <>
                          <span className="confirm">Delete {customer.name}?</span>
                          <button className="button small" onClick={() => setConfirming(null)} disabled={deleting}>Cancel</button>
                          <button className="button small danger" onClick={() => remove(customer)} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                        </>
                      ) : (
                        <>
                          {mayEdit && <button className="button small" aria-label={`Edit ${customer.name}`} onClick={() => open({ job: "edit", customer })}>Edit</button>}
                          {mayDelete && <button className="button small" aria-label={`Delete ${customer.name}`} onClick={() => { setConfirming(customer.id); setProblem(null); }}>Delete</button>}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.step === "ready" && !mayAdd && (
        <p className="hint muted">
          {mayEdit ? "Your role can view and edit customers. Adding or deleting one needs the Owner role." : "Your role can view customers. Changing them needs another role."}
        </p>
      )}
    </section>
  );
}
