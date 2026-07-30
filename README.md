# CLOUDSUFI Agentic Lead Magnet

Not a Q&A chatbot. An agentic sales engineer that runs discovery, captures a work
email, researches the company, generates a tailored one-pager PDF, and asks for a
15-minute meeting. Single Next.js app.

## Run it

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npm run dev               # http://localhost:3000
```

Works with only an Anthropic key. Without `DATABASE_URL` the chat, research, PDF,
and meeting CTA all still work — only persistence and `/admin` are skipped.

### With Postgres

```bash
createdb cloudsufi_chatbot
# set DATABASE_URL in .env, then:
npm run db:migrate
npm run db:seed-admin -- you@cloudsufi.com
```

## How it knows what to offer

This is the core of the system, and it is **not** improvised by the model.

[lib/catalog.ts](lib/catalog.ts) declares each offering with:

- `triggers` — the pains and stack hints that should surface it
- `outcomes` — what good looks like (directional, never guaranteed)
- `proof` — references we can actually stand behind
- `nextStep` / `shape` — the concrete ask and engagement shape

The prompt's catalog block **and** the PDF both read from this one file, so they
can never disagree. Edit this file to change what the bot sells.

On top of that, [lib/system-prompt.ts](lib/system-prompt.ts) defines a four-part
discovery framework the agent works through, one or two questions per turn:

1. **Pain** — pushed past the first vague answer
2. **Context** — industry and rough size
3. **Stack / state** — what they run, what's been tried
4. **Urgency & role** — funded and dated, or exploratory? Decision maker?

With pain plus one other field, it recommends. It does not need the full set.

## The conversation flow

```
greet + ask for a problem
   ↓
discovery questions        → record_discovery  (saved for the rep)
   ↓
deliver real value first
   ↓
ask for work email         → capture_email
   ├─ personal address? rejected, asked once more, then dropped
   └─ accepted → researches the company via web search, inline
   ↓
tailor the reply using what research found
   ↓
build the document         → create_one_pager  → PDF link
   ↓
ask for the meeting        → offer_meeting     → calendar link
```

Four tools in [lib/agent.ts](lib/agent.ts). The loop runs up to 6 model turns per
visitor message, streaming prose as it generates and emitting status events while
tools run.

## Verified working

Tested end to end against the live API:

- Rejected `roy@gmail.com`, asked again, accepted `@dematic.com`
- Researched Dematic, found it is KION-owned warehouse automation — **not
  retail** — and corrected its own diagnosis on that basis
- Generated a single-page PDF with a tailored headline and the situation drawn
  from the conversation
- Offered the 15-minute meeting with the calendar link

Latency after tuning: **~2s to first token, ~40s for a full turn** including web
search and PDF generation.

## Layout

| Path | Purpose |
|---|---|
| `lib/catalog.ts` | What we sell. Single source of truth. |
| `lib/system-prompt.ts` | GTM playbook + discovery framework. |
| `lib/agent.ts` | Tool definitions and the agentic loop. |
| `lib/research.ts` | Company research via web search, cached per domain. |
| `lib/email.ts` | Work-email gating (free/disposable rejection). |
| `lib/pdf.ts` | One-pager rendering. |
| `lib/offers.ts` | Offer persistence + unguessable tokens. |
| `lib/settings.ts` | Admin-editable calendar link. |
| `components/ChatWidget.tsx` | Widget. Renders prose, status, offer card, CTA. |
| `components/AdminDashboard.tsx` | Leads with expandable discovery + research. |

Admin → **Settings** sets the calendar URL (https only) and the meeting length
the agent says out loud. Point it at Calendly, HubSpot, or Google.

## Design decisions worth knowing

**Research runs inside `capture_email`, not as a separate model tool.** It is
cacheable per domain (paid for once, not per visitor) and it is capped at 25s —
an unbounded search would stall the visitor's turn indefinitely, which is exactly
the bug that showed up in testing.

**Lead detection is structured, not keyword matching.** The original spec flagged
a lead when the reply contained "demo" — which fires on *"we don't offer demos"*.

**One-pager links are unauthenticated by design** (128-bit random token) so the
visitor can forward them internally. Nothing sensitive goes on the page.

**`pdfkit` is marked `serverExternalPackages`.** Bundling it breaks its font
metrics lookup with `ENOENT ... Helvetica.afm`.

**Only ASCII in the PDF.** Built-in Helvetica uses WinAnsi encoding — `→` renders
as stray punctuation.

## Before you launch

- [ ] **Rate limiting is in-process.** On Vercel the real limit is
      `limit × instances`. Move to Redis/KV — every allowed request spends tokens,
      and this endpoint now costs several model calls plus a web search.
- [ ] **A full turn can take ~40s.** `maxDuration` is 120s. Watch the p99 on
      Vercel; if turns approach the ceiling, cut `MAX_TURNS` or drop research.
- [ ] **Cost per conversation is real.** Opus 4.8 across up to 6 turns plus web
      search plus extraction. Set `CHAT_MODEL` / `RESEARCH_MODEL` to a cheaper
      model if volume matters, and watch the credit balance.
- [ ] **Verify the catalog with your sales team.** Every `outcome` and `proof`
      string ships to prospects in a PDF. Wrong claims are a brand problem.
- [ ] **Set a real calendar URL** in Admin → Settings.
- [ ] **Transcript retention.** Chats and research summaries contain business
      information. Nothing expires them; GDPR export/delete is not implemented.
- [ ] **Admin 2FA** is not implemented.

## Not built

Email notification to the sales team on a hot lead, CRM push (HubSpot/Salesforce),
KB article admin UI, sentiment analysis, and the round-robin rep assignment from
Part 12 of the spec.
