import { getOffer } from "@/lib/offers";
import { renderOfferPdf } from "@/lib/pdf";
import { getSettings } from "@/lib/settings";
import { listPublishedServices } from "@/lib/services";
import { getCaseStudiesByIds } from "@/lib/case-studies";

export const runtime = "nodejs";

/**
 * GET /api/offer/:token — returns the tailored one-pager as a PDF.
 *
 * Deliberately unauthenticated: the visitor needs to open and forward this to
 * colleagues. The 128-bit random token is the only credential, so it must never
 * be shortened or made sequential. Nothing sensitive belongs on this page —
 * it's our own marketing copy plus the situation the visitor described.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  if (!/^[a-f0-9]{32}$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const offer = await getOffer(token);
  if (!offer) {
    return new Response("This one-pager has expired or does not exist.", { status: 404 });
  }

  try {
    const [settings, allServices, caseStudies] = await Promise.all([
      getSettings(),
      listPublishedServices(),
      getCaseStudiesByIds(offer.caseStudyIds),
    ]);

    const services = allServices.filter((s) => offer.recommended.includes(s.slug));

    const pdf = await renderOfferPdf({
      offer,
      services,
      caseStudies,
      ourCompany: settings.company_name,
      calendarUrl: settings.calendar_url,
    });

    const filename = `${settings.company_name}-${(offer.company ?? "one-pager").replace(/[^a-z0-9]+/gi, "-")}.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        // `inline` so it previews in the browser rather than forcing a download —
        // a preview gets read, a download often doesn't.
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("PDF render failed", token, error);
    return new Response("Could not generate the PDF. Please contact contact@cloudsufi.com.", {
      status: 500,
    });
  }
}
