import ChatWidget from "@/components/ChatWidget";

/**
 * Demo host page. In production you'd drop <ChatWidget /> onto the real
 * cloudsufi.com layout instead — everything it needs is self-contained.
 */
export default function HomePage() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <main className="cs-page">
      <p className="cs-eyebrow">CLOUDSUFI</p>
      <h1>Data engineering and AI, delivered by people who&rsquo;ve done it before.</h1>
      <p className="cs-lede">
        We help enterprises turn fragmented data into governed platforms, ship real Gen&nbsp;AI on
        top of it, and keep supply chains moving. Tell our assistant what you&rsquo;re solving —
        it&rsquo;ll point you to the right work and set up a 15-minute call.
      </p>

      {!hasKey && (
        <div className="cs-notice">
          <strong>ANTHROPIC_API_KEY is not set.</strong> The assistant will load but replies will
          fail until the key is configured.
        </div>
      )}

      <div className="cs-cards">
        <div className="cs-card">
          <h3>Data &amp; Advanced Analytics</h3>
          <p>Warehouse modernization, pipelines, and governance on Google Cloud and Oracle.</p>
        </div>
        <div className="cs-card">
          <h3>Generative AI</h3>
          <p>Gen AI Lab with 500 experts building LLM applications for real workloads.</p>
        </div>
        <div className="cs-card">
          <h3>Antifragile Supply Chain</h3>
          <p>Real-time visibility and optimization, with Kinaxis integration experience.</p>
        </div>
        <div className="cs-card">
          <h3>Managed Services</h3>
          <p>24/7 operations for the platforms we build, so your team ships instead of firefights.</p>
        </div>
      </div>

      <ChatWidget />
    </main>
  );
}
