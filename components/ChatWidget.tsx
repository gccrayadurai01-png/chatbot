"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GREETING, SUGGESTED_PROMPTS } from "@/lib/chat-copy";

type Product = { name: string; description: string };
type ServiceOption = { slug: string; name: string; description: string; products: Product[] };

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Tappable choices the agent offered, rendered as buttons under the bubble. */
  options?: string[];
  /** Set when the agent asked for contact — renders an inline name+email box. */
  askContact?: boolean;
  /** Attached cards, rendered under the bubble. */
  offer?: { url: string; headline: string };
  meeting?: { url: string; length: string };
  /** Set when this turn rejected a personal email — renders the bypass button. */
  emailRejected?: { email: string };
};

type AgentEvent =
  | { type: "text"; value: string }
  | { type: "status"; value: string }
  | { type: "options"; options: string[] }
  | { type: "email_prompt" }
  | { type: "email_captured"; email: string; company: string | null }
  | { type: "email_rejected"; email: string }
  | { type: "offer"; url: string; headline: string }
  | { type: "meeting"; url: string; length: string }
  | { type: "error"; value: string }
  | { type: "done" };

let nextId = 1;

export default function ChatWidget({ startOpen = true }: { startOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: nextId++, role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Persistent contact bar pinned at the top. The visitor can fill name + work
  // email any time; once saved we send it with every message so the agent never
  // asks again — it just uses their first name. Restored from localStorage.
  const [lead, setLead] = useState<{ name: string; email: string } | null>(null);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadEditing, setLeadEditing] = useState(true);
  const [leadPulse, setLeadPulse] = useState(false);
  const leadNameRef = useRef<HTMLInputElement>(null);

  // Service picker: real backend catalog, so admin edits show up with no
  // redeploy. `pickedService` drives a second level of chips (its products)
  // when it has any, matching "click a service, see its products."
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [pickedService, setPickedService] = useState<ServiceOption | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Latest messages, for building the stateless history sent with each request
  // (the server keeps no session store — see /api/chat/message).
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Latest lead, so the send callback (which doesn't depend on it) always posts
  // the current value.
  const leadRef = useRef<{ name: string; email: string } | null>(lead);
  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);

  // Restore a previously saved contact so returning visitors aren't asked again.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("cloudsufi_lead");
      if (raw) {
        const saved = JSON.parse(raw) as { name?: string; email?: string };
        if (saved.email) {
          const restored = { name: saved.name ?? "", email: saved.email };
          setLead(restored);
          setLeadName(restored.name);
          setLeadEmail(restored.email);
          setLeadEditing(false);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail.trim());

  // Set true when the agent is waiting on contact details, so saving the top form
  // auto-continues the conversation instead of the visitor having to type.
  const awaitingContactRef = useRef(false);
  // Latest send(), so saveLead (defined earlier) can call it.
  const sendRef = useRef<((text: string) => void) | null>(null);

  // Persist a name+email (from either the top bar or the inline chat box) and,
  // when the agent was waiting on it, auto-continue the conversation.
  const applyLead = useCallback((name: string, email: string, autoContinue: boolean) => {
    const next = { name: name.trim(), email: email.trim() };
    setLead(next);
    leadRef.current = next;
    setLeadName(next.name);
    setLeadEmail(next.email);
    setLeadEditing(false);
    setLeadPulse(false);
    try {
      localStorage.setItem("cloudsufi_lead", JSON.stringify(next));
    } catch {
      // ignore
    }
    // Retire any inline contact box now that we have the details.
    setMessages((prev) => prev.map((m) => (m.askContact ? { ...m, askContact: false } : m)));
    if (autoContinue) {
      const who = next.name ? `${next.name} here` : "Here";
      setTimeout(() => sendRef.current?.(`${who} — my details are in, go ahead.`), 0);
    }
  }, []);

  const saveLead = useCallback(() => {
    if (!emailValid) return;
    const shouldContinue = awaitingContactRef.current;
    awaitingContactRef.current = false;
    applyLead(leadName, leadEmail, shouldContinue);
  }, [emailValid, leadName, leadEmail, applyLead]);

  const visitorId = useRef<string | null>(null);
  if (visitorId.current === null && typeof window !== "undefined") {
    try {
      const existing = localStorage.getItem("cloudsufi_visitor");
      visitorId.current = existing ?? crypto.randomUUID();
      if (!existing) localStorage.setItem("cloudsufi_visitor", visitorId.current);
    } catch {
      visitorId.current = null; // Private browsing / storage disabled.
    }
  }

  const startSession = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visitorId: visitorId.current }),
      });
      const data = (await response.json()) as { sessionId?: string; error?: string };
      if (!response.ok || !data.sessionId) {
        setSessionError(data.error ?? "Could not connect to the assistant.");
        return null;
      }
      setSessionError(null);
      setSessionId(data.sessionId);
      return data.sessionId;
    } catch {
      setSessionError("Could not reach the server.");
      return null;
    }
  }, []);

  useEffect(() => {
    void startSession();

    // Best-effort — a failed fetch just means the static SUGGESTED_PROMPTS
    // fallback renders instead. Never blocks the chat itself.
    void (async () => {
      try {
        const res = await fetch("/api/services");
        if (!res.ok) return;
        const data = (await res.json()) as { services?: ServiceOption[] };
        if (data.services?.length) setServices(data.services);
      } catch {
        // Ignored — fallback chips cover this.
      }
    })();
  }, [startSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, status, pickedService]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming || !sessionId) return;

      // Snapshot the conversation so far (before this new turn) to send with the
      // request — the server is stateless and relies on this history.
      const priorHistory = messagesRef.current
        .filter((m) => m.content && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      while (priorHistory.length && priorHistory[0]!.role === "assistant") priorHistory.shift();

      setInput("");
      setPickedService(null); // Any real message retires the picker permanently.
      setMessages((prev) => [...prev, { id: nextId++, role: "user", content: trimmed }]);
      setStreaming(true);
      setStatus(null);

      const assistantId = nextId++;
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      const patch = (fn: (m: Message) => Message) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      const post = (id: string) =>
        fetch("/api/chat/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: id,
            message: trimmed,
            history: priorHistory,
            lead: leadRef.current ?? undefined,
          }),
        });

      try {
        let response = await post(sessionId);

        // The session can vanish underneath us (server restart, deleted row,
        // rotated instance). Start a fresh one and retry once rather than
        // dead-ending the visitor.
        if (response.status === 404) {
          const renewed = await startSession();
          if (!renewed) {
            patch((m) => ({ ...m, content: "Lost the connection. Please reload the page." }));
            return;
          }
          response = await post(renewed);
        }

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          patch((m) => ({
            ...m,
            content: data.error ?? "Something went wrong. Please try again.",
          }));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Buffer the whole reply and reveal it in ONE shot when the turn ends —
        // showing text token-by-token exposed the model's mid-thought edits and
        // read as janky. The animated typing dots run until this is revealed.
        let assistantText = "";
        let emailPromptFired = false;
        let pendingAskContact = false;
        let pendingOptions: string[] | undefined;
        let pendingOffer: { url: string; headline: string } | undefined;
        let pendingMeeting: { url: string; length: string } | undefined;
        let pendingRejected: { email: string } | undefined;

        const reveal = () => {
          // Guarantee a line when the agent silently asked for contact, so the
          // visitor never gets a blank bubble next to the pulsing form.
          const content =
            assistantText ||
            (emailPromptFired ? "Great — drop your name and work email just below." : "");
          patch((m) => ({
            ...m,
            content: content || m.content,
            options: pendingOptions ?? m.options,
            askContact: pendingAskContact || m.askContact,
            offer: pendingOffer ?? m.offer,
            meeting: pendingMeeting ?? m.meeting,
            emailRejected: pendingRejected ?? m.emailRejected,
          }));
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // NDJSON: complete lines only. A partial line stays in the buffer.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            let event: AgentEvent;
            try {
              event = JSON.parse(line) as AgentEvent;
            } catch {
              continue; // Ignore a malformed frame rather than killing the stream.
            }

            switch (event.type) {
              case "text":
                // Accumulate only — do NOT paint yet; keep the typing dots up.
                assistantText += event.value;
                break;
              case "status":
                setStatus(event.value);
                break;
              case "options":
                pendingOptions = event.options;
                break;
              case "email_prompt":
                // If they've already given contact details up top, don't nag —
                // the agent shouldn't be asking, but ignore gracefully if it does.
                if (!leadRef.current) {
                  emailPromptFired = true;
                  pendingAskContact = true; // inline name+email box under this message
                  setLeadPulse(true); // also nudge the top bar
                  awaitingContactRef.current = true;
                }
                break;
              case "offer":
                pendingOffer = { url: event.url, headline: event.headline };
                break;
              case "meeting":
                pendingMeeting = { url: event.url, length: event.length };
                break;
              case "email_rejected":
                pendingRejected = { email: event.email };
                break;
              case "error":
                // Reveal errors immediately so the visitor never stares at dots.
                assistantText += event.value;
                setStatus(null);
                reveal();
                break;
              case "email_captured":
                break;
              case "done":
                setStatus(null);
                reveal();
                break;
            }
          }
        }

        // Safety net: reveal whatever we have if the stream ended without a
        // "done" event.
        setStatus(null);
        reveal();
      } catch {
        patch((m) => ({
          ...m,
          content: m.content || "Connection lost. Please try again.",
        }));
      } finally {
        setStreaming(false);
        setStatus(null);
        inputRef.current?.focus();
      }
    },
    [sessionId, streaming, startSession],
  );

  // Keep sendRef current so saveLead (declared earlier) can auto-continue.
  useEffect(() => {
    sendRef.current = (text: string) => void send(text);
  }, [send]);

  /** One click, no retyping — the "I only have Gmail, let me continue" path. */
  const continueWithPersonalEmail = useCallback(
    (messageId: number, email: string) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, emailRejected: undefined } : m)));
      void send(`I don't have a company email right now — please continue with ${email}.`);
    },
    [send],
  );

  /** Tapping an option button sends its label and retires the buttons. */
  const chooseOption = useCallback(
    (messageId: number, label: string) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, options: undefined } : m)));
      void send(label);
    },
    [send],
  );

  const disabled = streaming || !sessionId;
  const showPicker = messages.length === 1 && !streaming;

  if (!isOpen) {
    return (
      <button className="cs-launcher" onClick={() => setIsOpen(true)} aria-label="Open chat">
        <span className="cs-launcher-dot" />
        Chat with CLOUDSUFI
      </button>
    );
  }

  return (
    <section
      className={`cs-widget${isExpanded ? " cs-widget-expanded" : ""}`}
      aria-label="CLOUDSUFI chat assistant"
    >
      <header className="cs-header">
        <div>
          <p className="cs-brand">CLOUDSUFI</p>
          <p className="cs-subtitle">
            <span className={`cs-status ${sessionId ? "online" : "connecting"}`} />
            {sessionError ? "Offline" : sessionId ? "Sales engineer" : "Connecting…"}
          </p>
        </div>
        <div className="cs-header-actions">
          <button
            className="cs-icon-btn"
            onClick={() => setIsExpanded((v) => !v)}
            aria-label={isExpanded ? "Shrink chat" : "Expand chat"}
            title={isExpanded ? "Shrink" : "Expand"}
          >
            {isExpanded ? "⤡" : "⤢"}
          </button>
          <button className="cs-icon-btn" onClick={() => setIsOpen(false)} aria-label="Minimize chat">
            &minus;
          </button>
        </div>
      </header>

      {lead && !leadEditing ? (
        <div className="cs-leadbar cs-leadbar-saved">
          <span className="cs-leadbar-check">✓</span>
          <span className="cs-leadbar-who">
            {lead.name ? `${lead.name} · ` : ""}
            {lead.email}
          </span>
          <button
            className="cs-leadbar-edit"
            onClick={() => setLeadEditing(true)}
            aria-label="Edit your details"
          >
            Edit
          </button>
        </div>
      ) : (
        <form
          className={`cs-leadbar${leadPulse ? " cs-leadbar-pulse" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            saveLead();
          }}
        >
          <input
            ref={leadNameRef}
            type="text"
            className="cs-leadinput"
            value={leadName}
            placeholder="Your name"
            autoComplete="given-name"
            onChange={(event) => setLeadName(event.target.value)}
          />
          <input
            type="email"
            className="cs-leadinput"
            value={leadEmail}
            placeholder="Work email"
            autoComplete="email"
            inputMode="email"
            onChange={(event) => setLeadEmail(event.target.value)}
          />
          <button type="submit" className="cs-leadsave" disabled={!emailValid}>
            Save
          </button>
        </form>
      )}

      <div className="cs-messages" ref={scrollRef}>
        {messages.map((message) => (
          <div key={message.id} className={`cs-row cs-row-${message.role}`}>
            <div className="cs-stack">
              {(message.content || message.role === "user") && (
                <div className={`cs-bubble cs-bubble-${message.role}`}>{message.content}</div>
              )}

              {!message.content && message.role === "assistant" && !message.offer && streaming && (
                <div className="cs-bubble cs-bubble-assistant">
                  <TypingDots />
                </div>
              )}

              {message.options && message.options.length > 0 && (
                <div className="cs-options">
                  {message.options.map((label) => (
                    <button
                      key={label}
                      className="cs-chip"
                      disabled={disabled}
                      onClick={() => chooseOption(message.id, label)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {message.askContact && !lead && (
                <ContactForm disabled={disabled} onSubmit={(n, e) => applyLead(n, e, true)} />
              )}

              {message.emailRejected && (
                <div className="cs-email-choice">
                  <button
                    className="cs-chip"
                    disabled={disabled}
                    onClick={() => continueWithPersonalEmail(message.id, message.emailRejected!.email)}
                  >
                    Continue with {message.emailRejected.email}
                  </button>
                  <span className="cs-email-hint">or just type your work email instead</span>
                </div>
              )}

              {message.offer && (
                <a className="cs-offer" href={message.offer.url} target="_blank" rel="noopener noreferrer">
                  <span className="cs-offer-icon">PDF</span>
                  <span className="cs-offer-text">
                    <strong>Your one-pager</strong>
                    <em>{message.offer.headline}</em>
                  </span>
                </a>
              )}

              {message.meeting && (
                <a
                  className="cs-meeting"
                  href={message.meeting.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Book {message.meeting.length} →
                </a>
              )}
            </div>
          </div>
        ))}

        {status && (
          <div className="cs-row cs-row-assistant">
            <div className="cs-working">
              <TypingDots />
              <span>{status}</span>
            </div>
          </div>
        )}

        {sessionError && (
          <p className="cs-error" role="alert">
            {sessionError} You can reach us at{" "}
            <a href="mailto:contact@cloudsufi.com">contact@cloudsufi.com</a>.
          </p>
        )}
      </div>

      {showPicker && !pickedService && (
        <div className="cs-suggestions">
          {(services.length > 0
            ? services.map((s) => (
                <button
                  key={s.slug}
                  className="cs-chip"
                  disabled={disabled}
                  onClick={() =>
                    s.products.length > 0
                      ? setPickedService(s)
                      : void send(`I'm interested in ${s.name} — ${s.description}`)
                  }
                >
                  {s.name}
                </button>
              ))
            : SUGGESTED_PROMPTS.map((prompt) => (
                <button key={prompt} className="cs-chip" disabled={disabled} onClick={() => void send(prompt)}>
                  {prompt}
                </button>
              )))}
        </div>
      )}

      {showPicker && pickedService && (
        <div className="cs-suggestions">
          <p className="cs-picker-label">{pickedService.name} — which one?</p>
          {pickedService.products.map((p) => (
            <button
              key={p.name}
              className="cs-chip"
              disabled={disabled}
              onClick={() => void send(`I'm interested in ${pickedService.name}, specifically ${p.name} — ${p.description}`)}
            >
              {p.name}
            </button>
          ))}
          <button
            className="cs-chip ghost"
            disabled={disabled}
            onClick={() => void send(`I'm interested in ${pickedService.name} — ${pickedService.description}`)}
          >
            Not sure — tell me more
          </button>
          <button className="cs-chip ghost" onClick={() => setPickedService(null)}>
            ← Back
          </button>
        </div>
      )}

      <form
        className="cs-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          className="cs-input"
          value={input}
          rows={1}
          placeholder={sessionId ? "Describe what's not working…" : "Connecting…"}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="submit"
          className="cs-send"
          disabled={disabled || !input.trim()}
          aria-label="Send message"
        >
          &uarr;
        </button>
      </form>
    </section>
  );
}

function TypingDots() {
  return (
    <span className="cs-typing" aria-label="Working">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Inline name + work-email box rendered right under the agent's message. */
function ContactForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, email: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <form
      className="cs-emailform"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !disabled) onSubmit(name, email);
      }}
    >
      <input
        ref={nameRef}
        type="text"
        className="cs-emailinput"
        value={name}
        placeholder="Your name"
        autoComplete="given-name"
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="cs-emailrow">
        <input
          type="email"
          className="cs-emailinput"
          value={email}
          placeholder="Work email"
          autoComplete="email"
          inputMode="email"
          disabled={disabled}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="cs-emailsend" disabled={disabled || !valid}>
          Send
        </button>
      </div>
    </form>
  );
}

