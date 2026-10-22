import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { InvoiceDoc } from "./invoice";
import { totals, fmtMoney, fmtQty, parseNum } from "./invoice";

/** Images as data URLs (JPEG). */
export type InvoiceImages = { logo?: string; stamp?: string };

const PAGE_W = 210;
const PAGE_H = 297;
const M = 14;              // page margin (mm)
const W = PAGE_W - 2 * M;  // content width
const LINE = 4.6;          // line height for 9pt text (mm)

const PURPLE: [number, number, number] = [112, 48, 160];
const BLOCK_FILL: [number, number, number] = [228, 223, 236];
const HEAD_FILL: [number, number, number] = [217, 217, 217];
const SOFT_FILL: [number, number, number] = [242, 242, 242];

/** Shrink the font until `text` fits in `maxW`; returns the size used. */
function fitFont(doc: jsPDF, text: string, maxW: number, start: number, min: number): number {
  let size = start;
  doc.setFontSize(size);
  while (size > min && doc.getTextWidth(text) > maxW) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

const wrap = (doc: jsPDF, text: string, w: number): string[] =>
  text.trim() ? (doc.splitTextToSize(text.trim(), w) as string[]) : [];

const money = (s: string) => {
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

  /* Header: logo + company name block */
  const headH = 30;
  doc.rect(M, y, W, headH);
  if (img.logo) doc.addImage(img.logo, "JPEG", M + 3, y + 4, 44, 22);
  const textW = W - 56;
  const cx = M + 52 + textW / 2;
  doc.setTextColor(...PURPLE);
  doc.setFont("helvetica", "bolditalic");
  fitFont(doc, inv.companyName, textW, 16, 9);
  doc.text(inv.companyName, cx, y + 10.5, { align: "center" });
  doc.setFont("helvetica", "italic");
  fitFont(doc, inv.companyAddress, textW, 10, 6);
  doc.text(inv.companyAddress, cx, y + 17.5, { align: "center" });
  fitFont(doc, inv.companyContact, textW, 8.5, 6);
  doc.text(inv.companyContact, cx, y + 24, { align: "center" });
  doc.setTextColor(0);
  y += headH;

  /* TO | TITLE | FROM block */
  const colL = 64, colM = 54, colR = W - colL - colM;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const left = [
    "TO:",
    ...wrap(doc, inv.clientName, colL - 4),
    ...wrap(doc, inv.clientAddress, colL - 4),
    ...(inv.clientTrn.trim() ? [`TRN: ${inv.clientTrn.trim()}`] : []),
  ];
  const right = [
    ...wrap(doc, inv.fromName, colR - 4),
    ...wrap(doc, `INVOICE NO: ${inv.invoiceNo}`, colR - 4),
    ...wrap(doc, `INVOICE DATE: ${inv.invoiceDate}`, colR - 4),
    ...wrap(doc, `TRN: ${inv.ourTrn}`, colR - 4),
  ];
  const blockH = Math.max(left.length, right.length, 3) * LINE + 5;
  doc.setFillColor(...BLOCK_FILL);
  doc.rect(M, y, W, blockH, "FD");
  doc.line(M + colL, y, M + colL, y + blockH);
  doc.line(M + colL + colM, y, M + colL + colM, y + blockH);
  left.forEach((s, i) => doc.text(s, M + 2, y + 5 + i * LINE));
  right.forEach((s, i) => doc.text(s, M + colL + colM + 2, y + 5 + i * LINE));
  doc.setFontSize(12);
  const titleLines = wrap(doc, inv.title, colM - 4);
  const titleTop = y + blockH / 2 - ((titleLines.length - 1) * 5) / 2 + 1.5;
  titleLines.forEach((s, i) => doc.text(s, M + colL + colM / 2, titleTop + i * 5, { align: "center" }));
  y += blockH;

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

  /* Account details (with stamp) + regards — kept together on one page */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const bank = wrap(doc, inv.bankLines, W / 2 - 4);
  const regards = wrap(doc, inv.regardsLines, W - 4);
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
  if (img.stamp) doc.addImage(img.stamp, "JPEG", M + W / 2 + 4, y + (bankH - 31) / 2, 52, 31);
  y += bankH;
  doc.rect(M, y, W, regH);
  regards.forEach((s, i) => doc.text(s, M + 2, y + 5.5 + i * 5.2));

  /* Page numbers when the invoice runs over one page */
  const pages = doc.getNumberOfPages();
  if (pages > 1) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.text(`Page ${p} of ${pages}`, PAGE_W / 2, PAGE_H - 7, { align: "center" });
    }
  }
  return doc;
}
