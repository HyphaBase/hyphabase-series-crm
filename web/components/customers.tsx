"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Customer } from "@/lib/customers";
import { CAN } from "@/lib/permissions";
import { AddCustomer } from "./add-customer";

type List = { step: "loading" } | { step: "ready"; customers: Customer[] } | { step: "failed"; message: string };

export function Customers({ permissions, onSessionEnded }: { permissions: string[]; onSessionEnded: () => void }) {
  const [list, setList] = useState<List>({ step: "loading" });
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // Hiding the button is a courtesy. The server checks the permission again on every request.
  const mayAdd = permissions.includes(CAN.addCustomers);

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

  function added(customer: Customer) {
    setList((current) => (current.step === "ready" ? { step: "ready", customers: [customer, ...current.customers] } : current));
    setJustAdded(customer.id);
    setAdding(false);
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
        {mayAdd && !adding && <button className="button primary" onClick={() => setAdding(true)}>Add customer</button>}
      </div>

      {adding && <AddCustomer onAdded={added} onCancel={() => setAdding(false)} onSessionEnded={onSessionEnded} />}

      <div className="card table-card">
        {list.step === "loading" && <p className="empty muted">Loading customers…</p>}
        {list.step === "failed" && <p className="empty error" role="alert">{list.message}</p>}
        {list.step === "ready" && list.customers.length === 0 && <p className="empty muted">No customers yet.</p>}
        {list.step === "ready" && list.customers.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th></tr>
            </thead>
            <tbody>
              {list.customers.map((customer) => (
                <tr key={customer.id} className={customer.id === justAdded ? "fresh" : undefined}>
                  <td className="strong">{customer.name}</td>
                  <td>{customer.email}</td>
                  <td>{customer.phone ?? <span className="muted">—</span>}</td>
                  <td><span className={`badge ${customer.status}`}>{customer.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!mayAdd && list.step === "ready" && <p className="hint muted">Your role can view customers. Adding one needs the Owner role.</p>}
    </section>
  );
}
