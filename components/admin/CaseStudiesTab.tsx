"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./api";

type CaseStudy = {
  id: string;
  client_name: string;
  industry: string | null;
  headline: string;
  challenge: string;
  solution: string;
  result_metric: string;
  service_slugs: string[];
  published: boolean;
};

const BLANK = {
  client_name: "",
  industry: "",
  headline: "",
  challenge: "",
  solution: "",
  result_metric: "",
  service_slugs: "",
  published: true,
};

export default function CaseStudiesTab() {
  const [items, setItems] = useState<CaseStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch<{ caseStudies: CaseStudy[] }>("/api/admin/case-studies");
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setItems(res.data.caseStudies);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePublished(c: CaseStudy) {
    setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, published: !x.published } : x)));
    await adminFetch(`/api/admin/case-studies/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ published: !c.published }),
    });
  }

  async function remove(c: CaseStudy) {
    if (!confirm(`Delete case study "${c.client_name}"?`)) return;
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    await adminFetch(`/api/admin/case-studies/${c.id}`, { method: "DELETE" });
  }

  async function create() {
    if (!form.client_name.trim() || !form.headline.trim() || !form.result_metric.trim()) {
      return setError("Client, headline, and result are all required.");
    }
    setSaving(true);
    const res = await adminFetch<{ caseStudy: CaseStudy }>("/api/admin/case-studies", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        service_slugs: form.service_slugs.split(",").map((s) => s.trim()).filter(Boolean),
      }),
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setForm(BLANK);
    setShowForm(false);
    void load();
  }

  return (
    <section>
      <div className="ad-section-head">
        <div>
          <h2>Case studies</h2>
          <p className="ad-muted">
            The proof the agent quotes (&ldquo;we helped a company like yours…&rdquo;) and prints in
            the PDF. The result is spoken to prospects — keep it verified.
          </p>
        </div>
        <button className="ad-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add case study"}
        </button>
      </div>

      <div className="ad-callout">
        The seeded examples are placeholders. Replace every <strong>result</strong> with a real,
        verified number before showing this to prospects.
      </div>

      {showForm && (
        <div className="ad-card ad-form">
          <div className="ad-grid2">
            <Field label="Client name (or 'a global retailer' if anonymized)">
              <input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
            </Field>
            <Field label="Industry">
              <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </Field>
          </div>
          <Field label="Result — the headline win (e.g. '2x online revenue in 9 months')">
            <input value={form.result_metric} onChange={(e) => setForm({ ...form, result_metric: e.target.value })} />
          </Field>
          <Field label="Headline (one-line summary)">
            <input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
          </Field>
          <Field label="Challenge">
            <textarea rows={2} value={form.challenge} onChange={(e) => setForm({ ...form, challenge: e.target.value })} />
          </Field>
          <Field label="Solution">
            <textarea rows={2} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} />
          </Field>
          <Field label="Service slugs this proves (comma separated, e.g. data-platform, gen-ai)">
            <input value={form.service_slugs} onChange={(e) => setForm({ ...form, service_slugs: e.target.value })} />
          </Field>
          <label className="ad-check">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
            Published
          </label>
          <button className="ad-btn" disabled={saving} onClick={() => void create()}>
            {saving ? "Saving…" : "Save case study"}
          </button>
        </div>
      )}

      {error && <p className="cs-error">{error}</p>}
      {loading ? (
        <p className="ad-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="ad-empty">No case studies yet. Add your best wins above.</p>
      ) : (
        <div className="ad-list">
          {items.map((c) => (
            <div key={c.id} className={`ad-item ${c.published ? "" : "draft"}`}>
              <div className="ad-item-main">
                <div className="ad-result">{c.result_metric}</div>
                <div className="ad-item-title">
                  {c.client_name}
                  {c.industry && <span className="ad-muted"> · {c.industry}</span>}
                  {!c.published && <span className="ad-tag">draft</span>}
                </div>
                <p className="ad-muted">{c.headline}</p>
                {c.service_slugs.length > 0 && (
                  <p className="ad-products">proves: {c.service_slugs.join(", ")}</p>
                )}
              </div>
              <div className="ad-item-actions">
                <button className="ad-btn-sm" onClick={() => void togglePublished(c)}>
                  {c.published ? "Unpublish" : "Publish"}
                </button>
                <button className="ad-btn-sm danger" onClick={() => void remove(c)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ad-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
