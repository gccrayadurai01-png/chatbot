import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt";
import { classifyEmail, companyNameFromDomain } from "./email";
import { researchCompany } from "./research";
import { saveOffer } from "./offers";
import { getSettings } from "./settings";
import { listPublishedServices } from "./services";
import { relevantCaseStudies } from "./case-studies";
import { markMeetingOffered, recordDiscovery, upsertLeadFromTool } from "./leads";

export const CHAT_MODEL = process.env.CHAT_MODEL ?? "claude-opus-4-8";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Events streamed to the browser as newline-delimited JSON.
 *
 * Richer than raw text because the widget needs to render more than prose: a
 * "researching…" status while a tool runs, an offer card with a download link,
 * and the meeting CTA as a real button.
 */
export type AgentEvent =
  | { type: "text"; value: string }
  | { type: "status"; value: string }
  // Tappable choices under the bot's message, so visitors click instead of type.
  | { type: "options"; options: string[] }
  // Tells the widget to render an inline email input for the next reply.
  | { type: "email_prompt" }
  | { type: "email_captured"; email: string; company: string | null }
  // Personal-address rejection with a one-click override, per the "if they
  // only have Gmail, let them click through" requirement — no retyping, no
  // being stuck arguing with the bot.
  | { type: "email_rejected"; email: string }
  | { type: "offer"; url: string; headline: string }
  | { type: "meeting"; url: string; length: string }
  | { type: "error"; value: string }
  | { type: "done" };

/**
 * Tools are built per run so the `recommended` enums reflect the CURRENT
 * published service slugs — the catalog is admin-managed and changes without a
 * deploy, so a hardcoded enum would drift out of sync.
 */
function buildTools(serviceSlugs: string[]): Anthropic.Tool[] {
  const slugItems =
    serviceSlugs.length > 0
      ? { type: "string" as const, enum: serviceSlugs }
      : { type: "string" as const };

  return [
    {
      name: "show_options",
      description:
        "Render tappable choice buttons under your message so the visitor can click " +
        "instead of typing. Use this every time your question has a few likely answers — " +
        "picking a service, a yes/no on the meeting, an industry, etc. The visitor's click " +
        "comes back as their next message containing the exact label you provided. Keep " +
        "labels short. Still write your one-line question in your reply as usual.",
      input_schema: {
        type: "object",
        properties: {
          options: {
            type: "array",
            description: "2 to 6 short button labels.",
            items: { type: "string" },
            minItems: 2,
            maxItems: 6,
          },
        },
        required: ["options"],
        additionalProperties: false,
      },
    },
    {
      name: "request_email",
      description:
        "Show the visitor an inline box that collects their NAME and WORK EMAIL, instead of the " +
        "normal chat box. Call this when you are asking for their contact details. Keep your own " +
        "reply to one short sentence asking for their name and work email. Their name and email " +
        "come back as their next message — then call capture_email with both.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "capture_email",
      description:
        "Record the visitor's email. Validates that it is a work address, not a personal " +
        "or disposable one. On success this also researches their company from the email " +
        "domain and returns what it found, so call this as soon as you have an address " +
        "and use the research in your next reply. If it returns rejected with reason " +
        "'free_provider', the UI shows the visitor a one-click 'Continue anyway' button — " +
        "do not also nag them for a work email in your reply, just acknowledge briefly. " +
        "If the visitor explicitly says to continue with the personal address (by clicking " +
        "that button or saying so), call this again with force:true and the same email.",
      input_schema: {
        type: "object",
        properties: {
          email: { type: "string", description: "The email address exactly as given." },
          name: { type: "string", description: "Visitor's name, if they shared it." },
          force: {
            type: "boolean",
            description:
              "Set true only when the visitor has explicitly chosen to continue with a " +
              "personal email despite the earlier rejection. Never set this on the first " +
              "attempt with an address you have not already tried.",
          },
        },
        required: ["email"],
        additionalProperties: false,
      },
    },
    {
      name: "record_discovery",
      description:
        "Save what you have learned about the visitor's situation. Call as soon as you " +
        "have their pain plus one other field, and call again to update as you learn more. " +
        "Do not wait for a complete picture.",
      input_schema: {
        type: "object",
        properties: {
          pain: {
            type: "string",
            description: "The specific problem in their words, not a generic category.",
          },
          context: { type: "string", description: "Industry and rough size." },
          stack: { type: "string", description: "What they run today; what they've tried." },
          urgency: { type: "string", description: "Funded and dated, or exploratory?" },
          role: { type: "string", description: "Decision maker, or gathering information?" },
          recommended: {
            type: "array",
            description: "Service slugs that fit. One or two — not everything.",
            items: slugItems,
          },
        },
        required: ["pain"],
        additionalProperties: false,
      },
    },
    {
      name: "create_one_pager",
      description:
        "Generate the tailored one-pager PDF and get a shareable link. The PDF is branded " +
        "with the visitor's company and (if known) their name, states their situation, and " +
        "automatically includes the most relevant CASE STUDIES for the services you pick. " +
        "Requires that you already have discovery. Do not invent metrics. Returns a URL you " +
        "must then give the visitor.",
      input_schema: {
        type: "object",
        properties: {
          headline: {
            type: "string",
            description: "Names their problem, not our product. Under 90 characters.",
          },
          situation: {
            type: "string",
            description:
              "Two or three sentences reflecting what they told you and what research found.",
          },
          recommended: {
            type: "array",
            description:
              "One or two service slugs. These select which case studies print, so choose " +
              "the services that best match their problem.",
            items: slugItems,
            minItems: 1,
          },
          outcomes: {
            type: "array",
            description: "Outcomes drawn from the catalog for the chosen services.",
            items: { type: "string" },
          },
          next_step: { type: "string", description: "The concrete next step you propose." },
        },
        required: ["headline", "situation", "recommended"],
        additionalProperties: false,
      },
    },
    {
      name: "offer_meeting",
      description:
        "Get the live scheduling link and meeting length so you can invite the visitor to " +
        "book. Call this when you are ready to ask for the meeting, then include the link " +
        "in your reply.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

/** Per-conversation state the tools mutate, so the loop can react. */
type AgentContext = {
  sessionId: string;
  baseUrl: string;
  domain: string | null;
  research: string | null;
  customerName: string | null;
};

async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
  emit: (event: AgentEvent) => void,
): Promise<string> {
  switch (name) {
    case "show_options": {
      const options = (Array.isArray(input.options) ? input.options : [])
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .map((o) => o.trim())
        .slice(0, 6);

      if (options.length === 0) {
        return JSON.stringify({ shown: false, error: "Provide 2-6 short option labels." });
      }

      emit({ type: "options", options });
      return JSON.stringify({
        shown: true,
        note: "Buttons are on screen. The visitor's click returns as their next message.",
      });
    }

    case "request_email": {
      emit({ type: "email_prompt" });
      return JSON.stringify({
        shown: true,
        note:
          "An email input box is now on screen. Keep your reply to one short sentence " +
          "asking for their work email.",
      });
    }

    case "capture_email": {
      const rawEmail = String(input.email ?? "");
      const force = input.force === true;
      const verdict = classifyEmail(rawEmail);

      if (!verdict.ok) {
        // Malformed addresses can't be forced — there's nothing valid to
        // accept. Disposable addresses are a trust signal, not a convenience
        // problem, so no override there either. Only free_provider gets the
        // one-click bypass, and only when the visitor hasn't already forced it.
        if (verdict.reason === "free_provider" && force && verdict.email && verdict.domain) {
          const company = companyNameFromDomain(verdict.domain);
          if (typeof input.name === "string" && input.name.trim()) {
            ctx.customerName = input.name.trim();
          }

          emit({ type: "email_captured", email: verdict.email, company: null });

          // Researching a free-mail domain (gmail.com) returns nothing useful
          // about the visitor's actual employer, so skip the call entirely —
          // it would just burn a search on the wrong company.
          await upsertLeadFromTool(ctx.sessionId, {
            email: verdict.email,
            name: typeof input.name === "string" ? input.name : null,
            domain: verdict.domain,
            company: null,
            researchSummary: null,
          });

          return JSON.stringify({
            accepted: true,
            email: verdict.email,
            domain: null,
            company_guess: null,
            research:
              "Personal email address — no company domain to research. If you don't already " +
              "know their company from the conversation, ask what company they're with so " +
              "you can tailor the one-pager; otherwise proceed with what they've told you.",
          });
        }

        if (verdict.reason === "free_provider") {
          emit({ type: "email_rejected", email: verdict.email ?? rawEmail });
        }

        return JSON.stringify({ accepted: false, reason: verdict.reason, tell_visitor: verdict.message });
      }

      const company = companyNameFromDomain(verdict.domain);
      ctx.domain = verdict.domain;
      const nameForLead = typeof input.name === "string" ? input.name : null;
      if (typeof input.name === "string" && input.name.trim()) {
        ctx.customerName = input.name.trim();
      }

      emit({ type: "email_captured", email: verdict.email, company });

      // Save the lead now, then keep going. Research used to run INLINE here with
      // a blocking web search — that was the 30s+ stall the visitor sat through
      // before their one-pager. It now runs in the BACKGROUND: it still lands on
      // the lead record for the rep and is cached per domain, but it never holds
      // up the conversation. The reply comes from what the visitor already told
      // us plus our case studies, which is all the one-pager needs.
      await upsertLeadFromTool(ctx.sessionId, {
        email: verdict.email,
        name: nameForLead,
        domain: verdict.domain,
        company,
        researchSummary: null,
      });

      void researchCompany(verdict.domain)
        .then((research) => {
          if (!research) return;
          ctx.research = research;
          return upsertLeadFromTool(ctx.sessionId, {
            email: verdict.email,
            name: nameForLead,
            domain: verdict.domain,
            company,
            researchSummary: research,
          });
        })
        .catch(() => undefined);

      return JSON.stringify({
        accepted: true,
        email: verdict.email,
        domain: verdict.domain,
        company_guess: company,
        instruction:
          "Email accepted. Do NOT wait for any research and do NOT ask more questions. " +
          "Right now, in one warm human line, connect their stated problem to a relevant " +
          "case study ('we solved this exact thing for a company like yours'), then call " +
          "create_one_pager, then immediately call offer_meeting. Keep it fast.",
      });
    }

    case "record_discovery": {
      const recommended = Array.isArray(input.recommended)
        ? input.recommended.filter((id): id is string => typeof id === "string")
        : [];

      await recordDiscovery(ctx.sessionId, {
        pain: String(input.pain ?? ""),
        context: typeof input.context === "string" ? input.context : null,
        stack: typeof input.stack === "string" ? input.stack : null,
        urgency: typeof input.urgency === "string" ? input.urgency : null,
        role: typeof input.role === "string" ? input.role : null,
        recommended,
      });

      return JSON.stringify({ saved: true });
    }

    case "create_one_pager": {
      const services = await listPublishedServices();
      const validSlugs = new Set(services.map((s) => s.slug));

      const slugs = (Array.isArray(input.recommended) ? input.recommended : [])
        .filter((id): id is string => typeof id === "string")
        .filter((id) => validSlugs.has(id));

      if (slugs.length === 0) {
        return JSON.stringify({
          created: false,
          error: `recommended must contain at least one valid service slug: ${[...validSlugs].join(", ")}`,
        });
      }

      emit({ type: "status", value: "Putting your one-pager together…" });

      const chosen = services.filter((s) => slugs.includes(s.slug));

      // Fall back to catalog outcomes when the model omits them, so the PDF is
      // never missing its substance.
      const outcomes = normalizeList(input.outcomes) ?? chosen.flatMap((s) => s.outcomes);

      // The proof is the case studies — the point of the whole document. Pick
      // the ones that match the recommended services.
      const caseStudies = await relevantCaseStudies(slugs, 2);

      const token = await saveOffer(ctx.sessionId, {
        company: ctx.domain ? companyNameFromDomain(ctx.domain) : null,
        customerName: ctx.customerName,
        headline: String(input.headline ?? "How we would approach this"),
        situation: String(input.situation ?? ""),
        recommended: slugs,
        outcomes: outcomes.slice(0, 6),
        caseStudyIds: caseStudies.map((c) => c.id),
        nextStep: typeof input.next_step === "string" ? input.next_step : "A short call to confirm fit.",
      });

      const url = `${ctx.baseUrl}/api/offer/${token}`;
      emit({ type: "offer", url, headline: String(input.headline ?? "Your one-pager") });

      // Hand the model the case-study lines so it can name a proof point out loud.
      return JSON.stringify({
        created: true,
        url,
        tell_visitor: `Share this link: ${url}`,
        case_studies_included: caseStudies.map((c) => `${c.client_name}: ${c.result_metric}`),
      });
    }

    case "offer_meeting": {
      const settings = await getSettings();
      await markMeetingOffered(ctx.sessionId);
      emit({
        type: "meeting",
        url: settings.calendar_url,
        length: settings.meeting_length,
      });
      return JSON.stringify({
        calendar_url: settings.calendar_url,
        meeting_length: settings.meeting_length,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

function normalizeList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return items.length > 0 ? items : null;
}

export type AgentResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Cap on model turns per visitor message. Each turn is a round trip, so this is
 * the main lever on worst-case latency. Six is enough for the deepest real path
 * (reply -> record_discovery -> capture_email+research -> create_one_pager ->
 * offer_meeting -> final reply).
 */
const MAX_TURNS = 6;

/**
 * Runs the agentic loop for one visitor message: the model may call tools
 * several times before producing its reply. Text is streamed to `emit` as it
 * is generated; tool activity is emitted as status events.
 */
export async function runAgent(
  history: ChatTurn[],
  ctx: AgentContext,
  emit: (event: AgentEvent) => void,
): Promise<AgentResult> {
  const client = new Anthropic();

  // Build the prompt and tools once per visitor message. The prompt pulls the
  // current catalog and case studies; the tools' `recommended` enum reflects the
  // current published service slugs.
  const [systemPrompt, services] = await Promise.all([
    buildSystemPrompt(),
    listPublishedServices(),
  ]);
  const tools = buildTools(services.map((s) => s.slug));

  const messages: Anthropic.MessageParam[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  let assistantText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // The model often writes prose, calls a tool, then writes more prose. Those
    // are separate turns, so without a separator the two runs collide mid-word
    // ("...tried before?Understood. There are two things..."). Insert a
    // paragraph break before the first chunk of each subsequent turn.
    let turnHasText = false;
    // A single newline (not a blank line) between the model's separate sub-turns
    // keeps a reply tight instead of scattering it into gappy paragraphs, while
    // still preventing words from colliding across turns ("...before?Understood").
    const separator = assistantText.trim().length > 0 ? "\n" : "";

    const stream = client.messages.stream({
      model: CHAT_MODEL,
      // Replies are one or two sentences by design; a tight cap is a backstop
      // against the wall-of-text failure mode. Tool-use turns fit easily too.
      max_tokens: 700,
      // cache_control on the system block caches prompt + tools together —
      // the biggest cost lever, since both are large and identical every call.
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      // Low effort on purpose: turns are 2-4 sentences and the visitor is
      // watching a spinner. Raise to "medium" if you'd trade ~2s for slightly
      // sharper discovery questions.
      output_config: { effort: "low" },
      tools,
      messages,
    });

    stream.on("text", (chunk) => {
      const value = turnHasText ? chunk : separator + chunk;
      turnHasText = true;
      assistantText += value;
      emit({ type: "text", value });
    });

    const message = await stream.finalMessage();
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;

    // Echo the assistant turn back verbatim — tool_use blocks must be preserved.
    messages.push({ role: "assistant", content: message.content });

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    // Execute every requested tool, then return all results in ONE user message.
    // Splitting them across messages trains the model out of parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      try {
        const output = await runTool(
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
          ctx,
          emit,
        );
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: output });
      } catch (error) {
        console.error(`tool ${toolUse.name} threw`, error);
        // Report the failure to the model rather than dropping the result — a
        // missing tool_result for a tool_use id is a 400 on the next request.
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: "Tool failed. Continue without it." }),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  return { text: assistantText, inputTokens, outputTokens };
}
