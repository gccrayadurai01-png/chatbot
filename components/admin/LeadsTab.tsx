"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { adminFetch } from "./api";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  interest: string | null;
  intent: string;
  status: string;
  message_count: string;
  domain: string | null;
  research_summary: string | null;
  offer_token: string | null;
  meeting_offered: boolean;
  pain: string | null;
  context: string | null;
  stack: string | null;
  urgency: string | null;
  role: string | null;
  recommended: string[] | null;
};

const STATUSES = ["new", "contacted", "qualified", "demo_booked", "won", "lost"];

export default function LeadsTab({ hasDatabase }: { hasDatabase: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    const res = await adminFetch<{ leads: Lead[] }>(`/api/admin/leads?${params}`);
    setLoaded(true);
    if (!res.ok) return setError(res.error);
    setError(null);
    setLeads(res.data.leads);
  }, [status, search]);

  useEffect(() => {
    if (!hasDatabase) return;
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load, hasDatabase]);

  async function updateStatus(id: string, next: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: next } : l)));
    await adminFetch(`/api/admin/leads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
  }

  if (!hasDatabase) {
    return (
      <section>
        <h2>Leads</h2>
        <p className="ad-empty">
          Lead capture needs a database. Set <code>DATABASE_URL</code> and run{" "}
          <code>npm run db:migrate</code> to store the conversations, emails, and company research
          the agent collects. Everything else works without it.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="ad-section-head">
        <div>
          <h2>Leads</h2>
          <p className="ad-muted">Captured emails with discovery notes and company research.</p>
        </div>
      </div>

      <div className="ad-toolbar">
        <input
          type="search"
          placeholder="Search company, email, name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="cs-error">{error}</p>}

      <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th />
              <th>Contact</th>
              <th>Company</th>
              <th>Fit</th>
              <th>Signals</th>
              <th>Msgs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <Fragment key={lead.id}>
                <tr>
                  <td>
                    <button
                      className="ad-expand"
                      onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                    >
                      {expanded === lead.id ? "−" : "+"}
                    </button>
                  </td>
                  <td>
                    {lead.name ?? "—"}
                    {lead.email && (
                      <>
                        <br />
                        <a href={`mailto:${lead.email}`} style={{ fontSize: 13 }}>
                          {lead.email}
                        </a>
                      </>
                    )}
                  </td>
                  <td>
                    {lead.company ?? "—"}
                    {lead.domain && (
                      <>
                        <br />
                        <span className="ad-muted" style={{ fontSize: 12 }}>
                          {lead.domain}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{lead.recommended?.join(", ") || lead.interest || "—"}</td>
                  <td>
                    <div className="ad-signals">
                      {lead.research_summary && <span className="ad-badge">researched</span>}
                      {lead.offer_token && (
                        <a
                          className="ad-badge link"
                          href={`/api/offer/${lead.offer_token}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          one-pager
                        </a>
                      )}
                      {lead.meeting_offered && <span className="ad-badge ready">meeting</span>}
                    </div>
                  </td>
                  <td>{lead.message_count}</td>
                  <td>
                    <select value={lead.status} onChange={(e) => void updateStatus(lead.id, e.target.value)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                {expanded === lead.id && (
                  <tr className="ad-detail-row">
                    <td colSpan={7}>
                      <div className="ad-detail">
                        <Detail label="Pain" value={lead.pain} />
                        <Detail label="Context" value={lead.context} />
                        <Detail label="Stack / state" value={lead.stack} />
                        <Detail label="Urgency" value={lead.urgency} />
                        <Detail label="Role" value={lead.role} />
                        <Detail label="Company research" value={lead.research_summary} wide />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {loaded && leads.length === 0 && (
          <p className="ad-empty">
            No leads yet. Have a conversation in the chatbot, share a work email, and it appears here
            with discovery notes and research.
          </p>
        )}
      </div>
    </section>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  if (!value) return null;
  return (
    <div className={wide ? "ad-detail-item wide" : "ad-detail-item"}>
      <span className="ad-detail-label">{label}</span>
      <span className="ad-detail-value">{value}</span>
    </div>
  );
}
