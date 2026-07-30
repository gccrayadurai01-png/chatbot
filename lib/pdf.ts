import PDFDocument from "pdfkit";
import type { Offer } from "./offers";
import type { Service } from "./services";
import type { CaseStudy } from "./case-studies";

const NAVY = "#0f2545";
const BLUE = "#2563eb";
const SLATE = "#475569";
const LIGHT = "#e3e8ef";
const GREEN = "#047857";

const PAGE_MARGIN = 54;

export type OfferPdfData = {
  offer: Offer;
  services: Service[];
  caseStudies: CaseStudy[];
  ourCompany: string; // e.g. "CLOUDSUFI"
  calendarUrl: string;
};

/**
 * Renders the tailored one-pager.
 *
 * Structure follows the sales ask: branded "Us × Them" header, the visitor's
 * situation, the recommended approach, then CASE STUDIES as the centerpiece —
 * "we helped a company like yours achieve X" — and a booking CTA.
 *
 * pdfkit is pure JS (no headless browser), so this deploys to serverless
 * without a Chromium layer. Cost: manual layout, and ASCII only — the built-in
 * Helvetica uses WinAnsi encoding with no glyph for characters like the arrow.
 */
export async function renderOfferPdf(data: OfferPdfData): Promise<Buffer> {
  const { offer, services, caseStudies, ourCompany, calendarUrl } = data;
  const client = offer.company ?? "Your company";

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    info: {
      Title: `${ourCompany} x ${client} — ${offer.headline}`,
      Author: ourCompany,
      Subject: offer.customerName ? `Prepared for ${offer.customerName}` : `Prepared for ${client}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const cw = doc.page.width - PAGE_MARGIN * 2;

  // --- Header band: "OURCO  x  CLIENT" ----------------------------------
  doc.rect(0, 0, doc.page.width, 96).fill(NAVY);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(`${ourCompany.toUpperCase()}  x  ${client}`, PAGE_MARGIN, 32, {
      width: cw,
      characterSpacing: 0.8,
    });
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#b8c6dd")
    .text(
      offer.customerName ? `Prepared for ${offer.customerName}` : "Prepared for your team",
      PAGE_MARGIN,
      58,
      { width: cw },
    );

  doc.y = 126;

  // --- Headline ----------------------------------------------------------
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(offer.headline, PAGE_MARGIN, doc.y, { width: cw, lineGap: 2 });
  doc.moveDown(0.7);

  // --- Situation ---------------------------------------------------------
  section(doc, "YOUR SITUATION", cw);
  para(doc, offer.situation, cw);
  doc.moveDown(0.9);

  // --- Recommended approach ---------------------------------------------
  if (services.length > 0) {
    section(doc, "HOW WE'D APPROACH IT", cw);
    for (const svc of services) {
      doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(11.5).text(svc.name, PAGE_MARGIN, doc.y, { width: cw });
      para(doc, svc.description, cw, 10);
      doc.moveDown(0.5);
    }
    doc.moveDown(0.3);
  }

  // --- Outcomes ----------------------------------------------------------
  if (offer.outcomes.length > 0) {
    section(doc, "WHAT GOOD LOOKS LIKE", cw);
    bullets(doc, offer.outcomes.slice(0, 4), cw);
    doc.moveDown(0.7);
  }

  // --- Case studies: the centerpiece ------------------------------------
  if (caseStudies.length > 0) {
    section(doc, "WE'VE DONE THIS FOR COMPANIES LIKE YOURS", cw);

    for (const cs of caseStudies) {
      const boxTop = doc.y;

      // Result metric as the loud line.
      doc
        .fillColor(GREEN)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(cs.result_metric, PAGE_MARGIN, boxTop + 2, { width: cw });

      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(`${cs.client_name}${cs.industry ? `  ·  ${cs.industry}` : ""}`, PAGE_MARGIN, doc.y + 1, {
          width: cw,
        });

      para(doc, cs.headline, cw, 9.5);
      doc.moveDown(0.6);
    }
    doc.moveDown(0.2);
  }

  // --- Next step CTA -----------------------------------------------------
  // Keep the box off the footer; if we're low on the page, let pdfkit flow it
  // but we size the content to fit one page for a typical 2-case-study offer.
  const boxTop = doc.y + 2;
  const boxHeight = 74;
  doc.roundedRect(PAGE_MARGIN, boxTop, cw, boxHeight, 8).fill("#eff6ff");
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("NEXT STEP", PAGE_MARGIN + 18, boxTop + 13, { width: cw - 36 });
  doc
    .fillColor(SLATE)
    .font("Helvetica")
    .fontSize(10)
    .text(offer.nextStep ?? "A short call to confirm fit.", PAGE_MARGIN + 18, boxTop + 29, {
      width: cw - 36,
      lineGap: 1,
    });
  doc
    .fillColor(BLUE)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Book a time", PAGE_MARGIN + 18, boxTop + 52, {
      width: cw - 36,
      link: calendarUrl,
      underline: true,
    });

  // --- Footer ------------------------------------------------------------
  const footerY = doc.page.height - PAGE_MARGIN - 40;
  doc
    .moveTo(PAGE_MARGIN, footerY)
    .lineTo(doc.page.width - PAGE_MARGIN, footerY)
    .lineWidth(0.75)
    .strokeColor(LIGHT)
    .stroke();
  doc
    .fillColor("#94a3b8")
    .font("Helvetica")
    .fontSize(7.5)
    .text("contact@cloudsufi.com  |  +1 (408) 462-0491  |  San Jose, CA", PAGE_MARGIN, footerY + 8, {
      width: cw,
      lineBreak: false,
    });
  doc.text(
    "Results shown are from prior engagements and are directional, not a guarantee. Scope, data volume, and timeline determine cost and outcomes.",
    PAGE_MARGIN,
    footerY + 20,
    { width: cw, lineGap: 1, height: 22 },
  );

  doc.end();
  return finished;
}

function section(doc: PDFKit.PDFDocument, label: string, width: number): void {
  doc
    .fillColor(BLUE)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text(label, PAGE_MARGIN, doc.y, { width, characterSpacing: 1.1 });
  doc.moveDown(0.35);
}

function para(doc: PDFKit.PDFDocument, text: string, width: number, size = 10.5): void {
  doc
    .fillColor(SLATE)
    .font("Helvetica")
    .fontSize(size)
    .text(text, PAGE_MARGIN, doc.y, { width, lineGap: 3 });
}

function bullets(doc: PDFKit.PDFDocument, items: string[], width: number): void {
  for (const item of items) {
    const y = doc.y;
    doc.circle(PAGE_MARGIN + 3, y + 5.5, 1.9).fill(BLUE);
    doc
      .fillColor(SLATE)
      .font("Helvetica")
      .fontSize(10.5)
      .text(item, PAGE_MARGIN + 14, y, { width: width - 14, lineGap: 3 });
    doc.moveDown(0.28);
  }
  doc.x = PAGE_MARGIN;
}
