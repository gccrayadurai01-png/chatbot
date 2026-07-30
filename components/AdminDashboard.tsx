"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ServicesTab from "./admin/ServicesTab";
import CaseStudiesTab from "./admin/CaseStudiesTab";
import LeadsTab from "./admin/LeadsTab";
import SettingsTab from "./admin/SettingsTab";

type Tab = "services" | "case-studies" | "leads" | "settings";

export default function AdminDashboard({
  email,
  hasDatabase,
}: {
  email: string;
  hasDatabase: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("services");

  const logout = useCallback(async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  }, [router]);

  // Bounce to login if any admin call 401s (session expired).
  useEffect(() => {
    const onUnauthorized = () => router.replace("/admin/login");
    window.addEventListener("admin-unauthorized", onUnauthorized);
    return () => window.removeEventListener("admin-unauthorized", onUnauthorized);
  }, [router]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "services", label: "Services" },
    { id: "case-studies", label: "Case studies" },
    { id: "leads", label: "Leads" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="ad-shell">
      <header className="ad-header">
        <div className="ad-brand">
          <span className="ad-logo">CLOUDSUFI</span>
          <span className="ad-brand-sub">Chatbot admin</span>
        </div>
        <div className="ad-header-right">
          <a className="ad-link" href="/" target="_blank" rel="noreferrer">
            View chatbot ↗
          </a>
          <span className="ad-email">{email}</span>
          <button className="ad-btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      {!hasDatabase && (
        <div className="ad-banner">
          Running in <strong>demo mode</strong> (no database). Everything works, but services,
          case studies, and settings reset when the server restarts, and leads aren&apos;t stored.
          Set <code>DATABASE_URL</code> to make it permanent.
        </div>
      )}

      <nav className="ad-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`ad-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="ad-body">
        {tab === "services" && <ServicesTab />}
        {tab === "case-studies" && <CaseStudiesTab />}
        {tab === "leads" && <LeadsTab hasDatabase={hasDatabase} />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
