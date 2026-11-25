"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { addPage, describeList, readListQuery, STATUSES, toSearch, type Customer, type ListFilter, type Status } from "@/lib/customers";
import { CAN } from "@/lib/permissions";
import { CustomerForm } from "./customer-form";
import { Notes } from "./notes";

/** `shows` is the filter the rows on screen answer, `nextPage` is the page after them, if there is one, and `total` is how many match in all. */
type List = { step: "loading" } | { step: "ready"; customers: Customer[]; nextPage: number | null; total: number; shows: ListFilter } | { step: "failed"; message: string };

// How long to wait after the last keystroke before asking the server.
const TYPING_PAUSE = 250;

/** What the panel above the table is doing, if it is open: a form, or one customer's notes. */
type Form = { job: "add" } | { job: "edit"; customer: Customer } | { job: "notes"; customer: Customer } | null;

export function Customers({ permissions, onSessionEnded }: { permissions: string[]; onSessionEnded: () => void }) {
  // The filter starts from the address, so a reload or a bookmark shows the same list.
  const [filter, setFilter] = useState<ListFilter>(() => readListQuery(window.location.search));
  const [typed, setTyped] = useState(filter.q);
  const [list, setList] = useState<List>({ step: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  // Counts the lists asked for. An answer to anything but the latest one is thrown away.
  const asked = useRef(0);
  const [form, setForm] = useState<Form>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Hiding a button is a courtesy. The server checks the permission again on every request.
  const mayAdd = permissions.includes(CAN.addCustomers);
  const mayEdit = permissions.includes(CAN.updateCustomers);
  const mayDelete = permissions.includes(CAN.deleteCustomers);

  // A new filter means a new list from the top: page one.
  useEffect(() => {
    const request = ++asked.current;
    window.history.replaceState(null, "", window.location.pathname + toSearch(filter));
    api.customers(filter).then(
      (page) => {
        if (request !== asked.current) return;
        setList({ step: "ready", customers: page.data, nextPage: page.next_page, total: page.total, shows: filter });
        setLoadingMore(false);
      },
      (error) => {
        if (request !== asked.current) return;
        if (error instanceof ApiError && error.status === 401) return onSessionEnded();
        setList({ step: "failed", message: error instanceof Error ? error.message : "Something went wrong." });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Typing does not search on every letter. It searches when the typing stops.
  useEffect(() => {
    const q = typed.trim();
    if (q === filter.q) return;
    const timer = setTimeout(() => setFilter((current) => ({ ...current, q })), TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [typed, filter.q]);

  function clear() {
    setTyped("");
    setFilter({ q: "", status: null });
  }

  async function loadMore() {
    if (list.step !== "ready" || !list.nextPage) return;
    const request = asked.current;
    setLoadingMore(true);
    setProblem(null);
    try {
      const page = await api.customers(list.shows, list.nextPage);
      if (request !== asked.current) return;
      setList((current) => (current.step === "ready" ? { ...current, customers: addPage(current.customers, page.data), nextPage: page.next_page, total: page.total } : current));
    } catch (error) {
      if (request !== asked.current) return;
      if (error instanceof ApiError && error.status === 401) return onSessionEnded();
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
    }
    setLoadingMore(false);
  }

  /** Changes the rows on screen, and the total by as many as were added or taken away. */
  const change = (customers: (current: Customer[]) => Customer[]) =>
    setList((current) => {
      if (current.step !== "ready") return current;
      const next = customers(current.customers);
      return { ...current, customers: next, total: current.total + next.length - current.customers.length };
    });

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
      setForm((current) => (current && current.job !== "add" && current.customer.id === customer.id ? null : current));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return onSessionEnded();
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
    }
    setConfirming(null);
    setDeleting(false);
  }

  const filtered = Boolean(filter.q || filter.status);
  // The rows on screen still answer the previous filter until the new answer arrives.
  const searching = list.step === "ready" && list.shows !== filter;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">
            {list.step === "ready" ? describeList(list.customers.length, list.total, list.shows) : "Portland"}
          </p>
        </div>
        {mayAdd && !form && <button className="button primary" onClick={() => open({ job: "add" })}>Add customer</button>}
      </div>

      {/* The key gives each customer a fresh form, so switching from one to another never shows the last one's values. */}
      {form?.job === "notes" && (
        <Notes key={form.customer.id} customer={form.customer} mayAdd={mayEdit} onClose={() => setForm(null)} onSessionEnded={onSessionEnded} />
      )}
      {form && form.job !== "notes" && (
        <CustomerForm
          key={form.job === "edit" ? form.customer.id : "new"}
          customer={form.job === "edit" ? form.customer : undefined}
          onSaved={saved}
          onCancel={() => setForm(null)}
          onSessionEnded={onSessionEnded}
        />
      )}

      <div className="toolbar" role="search">
        <input
          type="search"
          name="q"
          className="search"
          aria-label="Search customers by name, email or phone"
          placeholder="Search by name, email or phone"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <select name="status" aria-label="Status" value={filter.status ?? ""} onChange={(e) => setFilter({ q: typed.trim(), status: (e.target.value || null) as Status | null })}>
          <option value="">Any status</option>
          {STATUSES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select>
        {(filtered || typed) && <button className="button ghost" onClick={clear}>Clear</button>}
      </div>

      {problem && <p className="error list-error" role="alert">{problem}</p>}

      <div className={searching ? "card table-card searching" : "card table-card"} aria-busy={searching}>
        {list.step === "loading" && <p className="empty muted">Loading customers…</p>}
        {list.step === "failed" && <p className="empty error" role="alert">{list.message}</p>}
        {list.step === "ready" && list.customers.length === 0 && (
          <p className="empty muted">{list.shows.q || list.shows.status ? "No customers match. Search looks for one word: a first name, a last name, an email or a phone number." : "No customers yet."}</p>
        )}
        {list.step === "ready" && list.customers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>Status</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.customers.map((customer) => (
                <tr key={customer.id} className={customer.id === justSaved ? "fresh" : undefined}>
                  <td className="strong">{customer.name}</td>
                  <td>{customer.email}</td>
                  <td>{customer.phone}</td>
                  <td><span className={`badge ${customer.status}`}>{customer.status}</span></td>
                  <td className="row-actions">
                    {confirming === customer.id ? (
                      <>
                        <span className="confirm">Delete {customer.name}?</span>
                        <button className="button small" onClick={() => setConfirming(null)} disabled={deleting}>Cancel</button>
                        <button className="button small danger" onClick={() => remove(customer)} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                      </>
                    ) : (
                      <>
                        {/* Anyone who can see a customer can read their notes. Writing one needs the same permission as editing. */}
                        <button className="button small" aria-label={`Notes on ${customer.name}`} onClick={() => open({ job: "notes", customer })}>Notes</button>
                        {mayEdit && <button className="button small" aria-label={`Edit ${customer.name}`} onClick={() => open({ job: "edit", customer })}>Edit</button>}
                        {mayDelete && <button className="button small" aria-label={`Delete ${customer.name}`} onClick={() => { setConfirming(customer.id); setProblem(null); }}>Delete</button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.step === "ready" && list.nextPage && (
          <div className="more">
            <button className="button" onClick={loadMore} disabled={loadingMore || searching}>{loadingMore ? "Loading…" : "Load more"}</button>
          </div>
        )}
      </div>

      {list.step === "ready" && !mayAdd && (
        <p className="hint muted">
          {mayEdit ? "Your role can view and edit customers and add notes. Adding or deleting a customer needs the Owner role." : "Your role can view customers. Changing them needs another role."}
        </p>
      )}
    </section>
  );
}
