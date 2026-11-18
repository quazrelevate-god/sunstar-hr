import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellInput, RowInput } from "jspdf-autotable";
import type { InvoiceImages } from "./invoicePdf";
import {
  M, W, PAGE_W, PAGE_H, HEAD_FILL, SOFT_FILL, wrap,
  drawCompanyHeader, drawPartyBlock, drawAccountAndRegards, numberPages,
} from "./invoicePdf";
import { fmtMoney, parseNum } from "./invoice";
import type { ProformaDoc, SummaryDoc } from "./progress";
import { rowCalc, proformaTotals, summaryTotals, amountInWords, fmtPct, fmtQtyNum } from "./progress";

const SECTION_FILL: [number, number, number] = [255, 242, 204];
const BLUE: [number, number, number] = [31, 78, 156];
const dash = (n: number) => (n ? fmtMoney(n) : "-");
const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

/* ===================================================== PROFORMA INVOICE */

export function renderProformaPdf(p: ProformaDoc, img: InvoiceImages): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: `Proforma ${p.invoiceNo}`.trim(), author: p.companyName });
  doc.setTextColor(0);

  // Company header + parties + project + title, repeated on every page.
  const drawHeader = () => {
    let y = drawCompanyHeader(doc, p, img, M);
    y = drawPartyBlock(doc, {
      clientName: p.clientName, clientAddress: p.clientAddress, clientTrn: p.clientTrn, title: p.title,
      right: [p.fromName, `INVOICE NO: ${p.invoiceNo}`, `INVOICE DATE: ${p.invoiceDate}`, `TRN: ${p.ourTrn}`],
    }, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    if (p.project.trim()) {
      const lines = wrap(doc, `PROJECT: ${p.project.trim()}`, W - 4);
      const h = lines.length * 4.4 + 3;
      doc.rect(M, y, W, h);
      lines.forEach((s, i) => doc.text(s, M + 2, y + 4.6 + i * 4.4));
      y += h;
    }
    doc.setFillColor(...SOFT_FILL);
    doc.rect(M, y, W, 6.5, "FD");
    doc.text(p.title, PAGE_W / 2, y + 4.5, { align: "center" });
    return y + 6.5;
  };
  const top = drawHeader();

  // Body: section row per tower, then one row per level.
  const body: RowInput[] = [];
  let section = "", sIdx = -1, n = 0;
  for (const r of p.rows) {
    if (r.section !== section) {
      section = r.section; sIdx++; n = 0;
      const label = [r.section, p.scope.trim()].filter(Boolean).join(" - ");
      body.push([
        { content: letter(sIdx), styles: { fontStyle: "bold", halign: "center" } },
        { content: label, styles: { fontStyle: "bold", fillColor: SECTION_FILL } },
        ...Array.from({ length: 13 }, () => ""),
      ]);
    }
    n++;
    const c = rowCalc(r);
    const q = (s: string) => fmtQtyNum(parseNum(s) ?? 0);
    body.push([
      String(n), r.item, r.uom, r.contractQty.trim() ? q(r.contractQty) : "-",
      r.rate.trim() ? q(r.rate) : "-", c.contractAmt != null ? fmtMoney(c.contractAmt) : "-",
      q(r.prevQty), q(r.presentQty), fmtQtyNum(c.cumQty),
      fmtPct(c.prevPct), fmtPct(c.presPct), fmtPct(c.cumPct),
      dash(c.prevAmt), dash(c.presAmt), dash(c.cumAmt),
    ]);
  }

  const t = proformaTotals(p);
  const label = (text: string): CellInput => ({ content: text, colSpan: 14, styles: { halign: "right" } });
  const head: RowInput[] = [
    [
      { content: "Sl No", rowSpan: 2 }, { content: "Description", rowSpan: 2 }, { content: "UOM", rowSpan: 2 },
      { content: "Qty", rowSpan: 2 }, { content: "Rate", rowSpan: 2 }, { content: "Amount", rowSpan: 2 },
      { content: "QUANTITY", colSpan: 3 }, { content: "QUANTITY %", colSpan: 3 }, { content: "AMOUNT", colSpan: 3 },
    ],
    ["Prev.", "Present", "Cumul.", "Prev.", "Present", "Cumul.", "Prev.", "Present", "Cumul."],
  ];

  autoTable(doc, {
    startY: top,
    margin: { left: M, right: M, top, bottom: M + 6 },
    theme: "grid",
    head,
    body,
    foot: [
      [label("SUB TOTAL"), fmtMoney(t.subtotal)],
      [label(`RETENTION (${t.rRate}%)`), fmtMoney(t.retention)],
      [label("TOTAL"), fmtMoney(t.total)],
      [label(`VAT (${t.vRate}%)`), fmtMoney(t.vat)],
      [label("GRAND TOTAL"), fmtMoney(t.grand)],
    ],
    showFoot: "lastPage",
    showHead: "everyPage",
    styles: {
      font: "helvetica", fontSize: 6.8, textColor: 0, lineColor: 0, lineWidth: 0.2,
      cellPadding: 1.2, valign: "middle", halign: "right",
    },
    headStyles: { fillColor: HEAD_FILL, textColor: 0, fontStyle: "bold", halign: "center", fontSize: 6, cellPadding: 0.8 },
    footStyles: { fillColor: SOFT_FILL, textColor: 0, fontStyle: "bold", fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: "auto", halign: "left" },
      2: { cellWidth: 9, halign: "center" },
      3: { cellWidth: 9 }, 4: { cellWidth: 8 }, 5: { cellWidth: 14 },
      6: { cellWidth: 10 }, 7: { cellWidth: 10 }, 8: { cellWidth: 10 },
      9: { cellWidth: 9.5 }, 10: { cellWidth: 10 }, 11: { cellWidth: 10 },
      12: { cellWidth: 13.5 }, 13: { cellWidth: 14.5 }, 14: { cellWidth: 17 },
    },
    didParseCell: (d) => {
      if (d.section === "foot" && d.row.index === 4) d.cell.styles.fontSize = 8.5;
    },
    willDrawPage: (d) => { if (d.pageNumber > 1) drawHeader(); },
  });
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  drawAccountAndRegards(doc, p.bankLines, p.regardsLines, img.stamp, y);
  numberPages(doc);
  return doc;
}

/* ============================================= TAX INVOICE (summary page) */

export function renderSummaryPdf(s: SummaryDoc, img: InvoiceImages): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: `Tax invoice ${s.invoiceNo}`.trim(), author: "Sunstar Technical Services LLC" });
  doc.setTextColor(0);
  const L = 20, R = PAGE_W - 20, CW = R - L;
  let y = 12;

  // Letterhead: logo + company name, rule underneath.
  if (img.logo) doc.addImage(img.logo, "JPEG", L - 6, y, 44, 15.4);
  doc.setTextColor(...BLUE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(17);
  doc.text("SUNSTAR TECHNICAL SERVICES L.L.C", R, y + 13, { align: "right" });
  doc.setTextColor(0);
  y += 22;
  doc.setLineWidth(0.5);
  doc.line(0, y, PAGE_W, y);
  y += 9;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(s.title, PAGE_W / 2, y, { align: "center" });
  const tw = doc.getTextWidth(s.title);
  doc.setLineWidth(0.3);
  doc.line(PAGE_W / 2 - tw / 2, y + 1, PAGE_W / 2 + tw / 2, y + 1);
  y += 10;

  // Number / date, reference / PC
  doc.setFontSize(10);
  doc.text(`INVOICE NO: ${s.invoiceNo}`, L, y);
  doc.text(`Date: ${s.invoiceDate}`, R, y, { align: "right" });
  y += 8;
  if (s.reference.trim() || s.pcNo.trim()) {
    if (s.reference.trim()) doc.text(s.reference.trim(), L, y);
    if (s.pcNo.trim()) doc.text(s.pcNo.trim(), R - 25, y);
    y += 8;
  }

  // From / To blocks
  const block = (heading: string, name: string, lines: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(heading, L, y); y += 6;
    if (name.trim()) { wrap(doc, name, CW).forEach((t) => { doc.text(t, L, y); y += 5.6; }); }
    doc.setFont("helvetica", "normal");
    wrap(doc, lines, CW).forEach((t) => { doc.text(t, L, y); y += 5.6; });
  };
  const [fromName, ...fromRest] = s.fromLines.split("\n");
  block("From,", fromName ?? "", fromRest.join("\n"));
  block("To", s.toName, s.toLines);

  // Subject / project: bold label, normal text
  const labelled = (lbl: string, text: string, size: number) => {
    if (!text.trim()) return;
    doc.setFontSize(size);
    doc.setFont("helvetica", "bold");
    const lw = doc.getTextWidth(`${lbl}: `);
    doc.text(`${lbl}:`, L, y);
    doc.setFont("helvetica", "normal");
    const lines = wrap(doc, text, CW - lw);
    lines.forEach((t, i) => doc.text(t, L + lw, y + i * 5));
    y += lines.length * 5 + 2.5;
  };
  labelled("Subject", s.subject, 9.5);
  labelled("PROJECT", s.project, 8.5);
  y += 2;

  // Works done table
  const t = summaryTotals(s);
  autoTable(doc, {
    startY: y,
    margin: { left: L - 2, right: 20 - 2 },
    theme: "grid",
    head: [["Works Done Details", "AMOUNT"]],
    body: [
      ["Total Amount of Work Done:", fmtMoney(t.work)],
      [`Less Retention ${t.rRate}%:`, fmtMoney(t.retention)],
      ["Net Payable Amount Before VAT:", fmtMoney(t.net)],
      [`VAT ${t.vRate}%:`, fmtMoney(t.vat)],
      ["Net Payable Amount Due:", fmtMoney(t.due)],
      [{ content: `UAE Dirham: ${amountInWords(t.due)}`, colSpan: 2, styles: { fontSize: 11, halign: "justify" } }],
    ],
    styles: { font: "helvetica", fontSize: 10, textColor: 0, lineColor: 0, lineWidth: 0.25, cellPadding: 1.8 },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 38, halign: "right" } },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  // Regards + stamp
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Thanks & Regards", L, y); y += 5;
  const [forLbl, ...forName] = s.regardsName.split(/(?<=^For)\s/);
  if (forName.length) {
    doc.text(`${forLbl} `, L, y);
    doc.setFont("helvetica", "bold");
    doc.text(forName.join(" "), L + doc.getTextWidth(`${forLbl} `), y);
    doc.setFont("helvetica", "normal");
  } else doc.text(s.regardsName, L, y);
  y += 5;
  s.regardsLines.split("\n").forEach((t) => { doc.text(t, L, y); y += 5; });
  if (img.stamp) doc.addImage(img.stamp, "JPEG", L + 55, y - 12, 48, 28.6);

  // Footer strip
  const fy = PAGE_H - 22;
  doc.setLineWidth(0.5);
  doc.line(0, fy, PAGE_W, fy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  s.footerLines.split("\n").forEach((t, i) => doc.text(t, PAGE_W / 2, fy + 7 + i * 6, { align: "center" }));
  return doc;
}
