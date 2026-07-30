"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "./api";

type Settings = { calendar_url: string; meeting_length: string; company_name: string };

export default function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await adminFetch<Settings>("/api/admin/settings");
      if (res.ok) setSettings(res.data);
      else setErr(res.error);
    })();
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    setErr(null);
    const res = await adminFetch<{ settings: Settings }>("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    setSaving(false);
    if (!res.ok) return setErr(res.error);
    setSettings(res.data.settings);
    setMsg("Saved. The chatbot uses these within 30 seconds.");
  }

  if (!settings) {
    return <p className="ad-muted">{err ?? "Loading…"}</p>;
  }

  return (
    <section className="ad-settings">
      <h2>Settings</h2>
      <p className="ad-muted">Used across the chatbot, the one-pager PDF, and the meeting CTA.</p>

      <label className="ad-field">
        <span>Your company name (shown as &ldquo;{settings.company_name} × Client&rdquo; on the PDF)</span>
        <input value={settings.company_name} onChange={(e) => setSettings({ ...settings, company_name: e.target.value })} />
      </label>

      <label className="ad-field">
        <span>Calendar / booking URL (https) — Calendly, HubSpot, or Google</span>
        <input value={settings.calendar_url} onChange={(e) => setSettings({ ...settings, calendar_url: e.target.value })} />
      </label>

      <label className="ad-field">
        <span>Meeting length, as the agent says it</span>
        <input value={settings.meeting_length} onChange={(e) => setSettings({ ...settings, meeting_length: e.target.value })} />
      </label>

      {err && <p className="cs-error">{err}</p>}
      {msg && <p className="ad-note">{msg}</p>}

      <button className="ad-btn" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save settings"}
      </button>
    </section>
  );
}
