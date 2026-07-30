"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "./api";

type Product = { name: string; description: string };
type Service = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  products: Product[];
  triggers: string[];
  outcomes: string[];
  published: boolean;
  source_url: string | null;
};

const BLANK = {
  name: "",
  description: "",
  category: "",
  triggers: "",
  outcomes: "",
  products: "",
  published: true,
};

export default function ServicesTab() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Website ingestion
  const [url, setUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);

  // New service form
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch<{ services: Service[] }>("/api/admin/services");
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setServices(res.data.services);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function ingest() {
    if (!url.trim()) return;
    setIngesting(true);
    setIngestMsg(null);
    const res = await adminFetch<{ message: string }>("/api/admin/services/ingest", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    setIngesting(false);
    if (!res.ok) return setIngestMsg(res.error);
    setIngestMsg(res.data.message);
    setUrl("");
    void load();
  }

  async function togglePublished(s: Service) {
    setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, published: !x.published } : x)));
    await adminFetch(`/api/admin/services/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ published: !s.published }),
    });
  }

  async function remove(s: Service) {
    if (!confirm(`Delete "${s.name}"?`)) return;
    setServices((prev) => prev.filter((x) => x.id !== s.id));
    await adminFetch(`/api/admin/services/${s.id}`, { method: "DELETE" });
  }

  async function create() {
    if (!form.name.trim()) return setError("Service name is required.");
    setSaving(true);
    const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
    const products = lines(form.products).map((line) => {
      const [name, ...rest] = line.split("—");
      return { name: (name ?? "").trim(), description: rest.join("—").trim() };
    });

    const res = await adminFetch<{ service: Service }>("/api/admin/services", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        description: form.description,
        category: form.category,
        triggers: lines(form.triggers.replace(/,/g, "\n")),
        outcomes: lines(form.outcomes),
        products,
        published: form.published,
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
          <h2>Services</h2>
          <p className="ad-muted">
            These appear as clickable options in the chatbot and drive what the agent recommends.
          </p>
        </div>
        <button className="ad-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add service"}
        </button>
      </div>

      {/* Website ingestion */}
      <div className="ad-card ad-ingest">
        <div>
          <strong>Import from your website</strong>
          <p className="ad-muted">
            Paste your services or solutions page URL — the agent reads it and drafts the services
            for you to review.
          </p>
        </div>
        <div className="ad-ingest-row">
          <input
            placeholder="https://www.cloudsufi.com/services/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void ingest()}
          />
          <button className="ad-btn" disabled={ingesting} onClick={() => void ingest()}>
            {ingesting ? "Reading…" : "Import"}
          </button>
        </div>
        {ingestMsg && <p className="ad-note">{ingestMsg}</p>}
      </div>

      {showForm && (
        <div className="ad-card ad-form">
          <div className="ad-grid2">
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Category (optional)">
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>
          <Field label="One-line description">
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Trigger keywords (comma or newline separated — what customer pains surface this)">
            <textarea rows={2} value={form.triggers} onChange={(e) => setForm({ ...form, triggers: e.target.value })} />
          </Field>
          <Field label="Outcomes (one per line)">
            <textarea rows={3} value={form.outcomes} onChange={(e) => setForm({ ...form, outcomes: e.target.value })} />
          </Field>
          <Field label="Products (one per line, format: Name — description)">
            <textarea rows={3} value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} />
          </Field>
          <label className="ad-check">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm({ ...form, published: e.target.checked })}
            />
            Publish now (show in the chatbot)
          </label>
          <button className="ad-btn" disabled={saving} onClick={() => void create()}>
            {saving ? "Saving…" : "Save service"}
          </button>
        </div>
      )}

      {error && <p className="cs-error">{error}</p>}
      {loading ? (
        <p className="ad-muted">Loading…</p>
      ) : services.length === 0 ? (
        <p className="ad-empty">No services yet. Import from your website or add one above.</p>
      ) : (
        <div className="ad-list">
          {services.map((s) => (
            <div key={s.id} className={`ad-item ${s.published ? "" : "draft"}`}>
              <div className="ad-item-main">
                <div className="ad-item-title">
                  {s.name}
                  {!s.published && <span className="ad-tag">draft</span>}
                  {s.source_url && <span className="ad-tag src">imported</span>}
                </div>
                <p className="ad-muted">{s.description}</p>
                {s.products.length > 0 && (
                  <p className="ad-products">{s.products.map((p) => p.name).join(" · ")}</p>
                )}
              </div>
              <div className="ad-item-actions">
                <button className="ad-btn-sm" onClick={() => void togglePublished(s)}>
                  {s.published ? "Unpublish" : "Publish"}
                </button>
                <button className="ad-btn-sm danger" onClick={() => void remove(s)}>
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
