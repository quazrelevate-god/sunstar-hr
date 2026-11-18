import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceDoc } from "./invoice";
import { totals, fmtMoney, fmtQty, parseNum } from "./invoice";

/** Images as data URLs (JPEG). */
export type InvoiceImages = { logo?: string; stamp?: string };

export const PAGE_W = 210;
export const PAGE_H = 297;
export const M = 14;              // page margin (mm)
export const W = PAGE_W - 2 * M;  // content width
export const LINE = 4.6;          // line height for 9pt text (mm)

export const PURPLE: [number, number, number] = [112, 48, 160];
export const BLOCK_FILL: [number, number, number] = [228, 223, 236];
export const HEAD_FILL: [number, number, number] = [217, 217, 217];
export const SOFT_FILL: [number, number, number] = [242, 242, 242];

/** Shrink the font until `text` fits in `maxW`; returns the size used. */
export function fitFont(doc: jsPDF, text: string, maxW: number, start: number, min: number): number {
  let size = start;
  doc.setFontSize(size);
  while (size > min && doc.getTextWidth(text) > maxW) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

export const wrap = (doc: jsPDF, text: string, w: number): string[] =>
  text.trim() ? (doc.splitTextToSize(text.trim(), w) as string[]) : [];

export const money = (s: string) => {
  const n = parseNum(s);
  return n == null ? s : fmtMoney(n);
};

export function renderInvoicePdf(inv: InvoiceDoc, img: InvoiceImages): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: `Invoice ${inv.invoiceNo}`.trim(), author: inv.companyName });
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.setTextColor(0);
  let y = M;

  y = drawCompanyHeader(doc, inv, img, y);
  y = drawPartyBlock(doc, {
    clientName: inv.clientName, clientAddress: inv.clientAddress, clientTrn: inv.clientTrn, title: inv.title,
    right: [
      inv.fromName,
      `INVOICE NO: ${inv.invoiceNo}`,
      `INVOICE DATE: ${inv.invoiceDate}`,
      ...(inv.period.trim() ? [`PERIOD: ${inv.period.trim()}`] : []),
      `TRN: ${inv.ourTrn}`,
    ],
  }, y);

  /* Optional reference rows — left off the PDF when empty */
  if (inv.project.trim()) {
    const h = 9;
    doc.setFillColor(...SOFT_FILL);
    doc.rect(M, y, W, h, "FD");
    doc.line(M + 28, y, M + 28, y + h);
    doc.setFontSize(8);
    doc.text("PROJECT NAME", M + 2, y + 5.6);
    fitFont(doc, inv.project.trim(), W - 32, 12, 7);
    doc.text(inv.project.trim(), M + 28 + (W - 28) / 2, y + 6.2, { align: "center" });
    y += h;
  }
  if (inv.jobNo.trim() || inv.lpoRef.trim()) {
    const h = 7;
    doc.rect(M, y, W, h);
    doc.setFontSize(9);
    if (inv.jobNo.trim()) doc.text(`JOB NO: ${inv.jobNo.trim()}`, M + 2, y + 4.8);
    if (inv.lpoRef.trim()) doc.text(`LPO REF: ${inv.lpoRef.trim()}`, M + W - 2, y + 4.8, { align: "right" });
    y += h;
  }

  /* Line items + totals */
  const t = totals(inv);
  const lines = inv.lines.filter((l) => [l.desc, l.qty, l.unit, l.rate, l.amount].some((v) => v.trim()));
  const label = { colSpan: 5, styles: { halign: "right" as const } };
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: M, bottom: M + 6 },
    theme: "grid",
    head: [["S.NO", "DESCRIPTION", "QTY", "UNIT", "RATE (AED)", "AMOUNT (AED)"]],
    body: lines.map((l, i) => [String(i + 1), l.desc, fmtQty(l.qty), l.unit, money(l.rate), money(l.amount)]),
    foot: [
      [{ content: "SUB TOTAL", ...label }, fmtMoney(t.subtotal)],
      [{ content: `VAT (${t.rate}%)`, ...label }, fmtMoney(t.vat)],
      [{ content: "GRAND TOTAL", ...label }, fmtMoney(t.grand)],
    ],
    showFoot: "lastPage",
    styles: {
      font: "helvetica", fontSize: 9, textColor: 0, lineColor: 0, lineWidth: 0.2,
      cellPadding: 2, valign: "middle",
    },
    headStyles: { fillColor: HEAD_FILL, textColor: 0, fontStyle: "bold", halign: "center" },
    footStyles: { fillColor: SOFT_FILL, textColor: 0, fontStyle: "bold", halign: "right" },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 14, halign: "center" },
      4: { cellWidth: 24, halign: "right" },
      5: { cellWidth: 28, halign: "right" },
    },
    didParseCell: (d) => {
      if (d.section === "foot" && d.row.index === 2) d.cell.styles.fontSize = 10.5;
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  drawAccountAndRegards(doc, inv.bankLines, inv.regardsLines, img.stamp, y);

  numberPages(doc);
  return doc;
}

/* ------------------------------------------------------------------ shared */

/** Boxed header: logo + company name, address, contact. Returns the new y. */
export function drawCompanyHeader(
  doc: jsPDF,
  c: { companyName: string; companyAddress: string; companyContact: string },
  img: InvoiceImages,
  y: number,
): number {
  const headH = 30;
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(M, y, W, headH);
  // Logo is ~2.86:1 (900×315); centred vertically in the header box.
  if (img.logo) doc.addImage(img.logo, "JPEG", M + 3, y + (headH - 16.1) / 2, 46, 16.1);
  const textW = W - 56;
  const cx = M + 52 + textW / 2;
  doc.setTextColor(...PURPLE);
  doc.setFont("helvetica", "bolditalic");
  fitFont(doc, c.companyName, textW, 16, 9);
  doc.text(c.companyName, cx, y + 10.5, { align: "center" });
  doc.setFont("helvetica", "italic");
  fitFont(doc, c.companyAddress, textW, 10, 6);
  doc.text(c.companyAddress, cx, y + 17.5, { align: "center" });
  fitFont(doc, c.companyContact, textW, 8.5, 6);
  doc.text(c.companyContact, cx, y + 24, { align: "center" });
  doc.setTextColor(0);
  return y + headH;
}

/** TO | TITLE | FROM block. `right` lines are printed as given. Returns the new y. */
export function drawPartyBlock(
  doc: jsPDF,
  p: { clientName: string; clientAddress: string; clientTrn: string; title: string; right: string[] },
  y: number,
): number {
  const colL = 64, colM = 54, colR = W - colL - colM;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const left = [
    "TO:",
    ...wrap(doc, p.clientName, colL - 4),
    ...wrap(doc, p.clientAddress, colL - 4),
    ...(p.clientTrn.trim() ? [`TRN: ${p.clientTrn.trim()}`] : []),
  ];
  const right = p.right.flatMap((line) => wrap(doc, line, colR - 4));
  const blockH = Math.max(left.length, right.length, 3) * LINE + 5;
  doc.setFillColor(...BLOCK_FILL);
  doc.rect(M, y, W, blockH, "FD");
  doc.line(M + colL, y, M + colL, y + blockH);
  doc.line(M + colL + colM, y, M + colL + colM, y + blockH);
  left.forEach((s, i) => doc.text(s, M + 2, y + 5 + i * LINE));
  right.forEach((s, i) => doc.text(s, M + colL + colM + 2, y + 5 + i * LINE));
  doc.setFontSize(12);
  const titleLines = wrap(doc, p.title, colM - 4);
  const titleTop = y + blockH / 2 - ((titleLines.length - 1) * 5) / 2 + 1.5;
  titleLines.forEach((s, i) => doc.text(s, M + colL + colM / 2, titleTop + i * 5, { align: "center" }));
  return y + blockH;
}

/** Account details (with stamp) + regards, kept together on one page. */
export function drawAccountAndRegards(doc: jsPDF, bankLines: string, regardsLines: string, stamp: string | undefined, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const bank = wrap(doc, bankLines, W / 2 - 4);
  const regards = wrap(doc, regardsLines, W - 4);
  const bankH = Math.max(bank.length * 5.2 + 5, 36);
  const regH = Math.max(regards.length, 1) * 5.2 + 5;
  if (y + 7 + bankH + regH > PAGE_H - M - 6) {
    doc.addPage();
    y = M;
  }
  doc.setFillColor(...HEAD_FILL);
  doc.rect(M, y, W, 7, "FD");
  doc.text("ACCOUNT DETAILS", M + 2, y + 4.8);
  y += 7;
  doc.rect(M, y, W, bankH);
  bank.forEach((s, i) => doc.text(s, M + 2, y + 5.5 + i * 5.2));
  if (stamp) doc.addImage(stamp, "JPEG", M + W / 2 + 4, y + (bankH - 31) / 2, 52, 31);
  y += bankH;
  doc.rect(M, y, W, regH);
  regards.forEach((s, i) => doc.text(s, M + 2, y + 5.5 + i * 5.2));
}

/** "Page n of N" footers when a document runs over one page. */
export function numberPages(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  if (pages <= 1) return;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.text(`Page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 7, { align: "center" });
  }
  doc.setTextColor(0);
}
