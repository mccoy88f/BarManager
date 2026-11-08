import { jsPDF } from 'jspdf';

export interface MenuPdfCategory {
  id: string;
  name: string;
}

export interface MenuPdfItem {
  name: string;
  description?: string;
  categoryId: string;
  visible: boolean;
  variants: { name: string; price: number | null }[];
}

const PAGE_W = 210;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 284;

function formatMenuPrice(price: number | null): string {
  if (price == null) return 'Prezzo variabile';
  return `${price.toFixed(2).replace('.', ',')} €`;
}

function filename(venueName: string): string {
  const safe = venueName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${safe || 'menu'}.pdf`;
}

/**
 * PDF del menù creato nel browser. Per ogni voce: nome, sotto la
 * descrizione, sotto ancora il prezzo (una riga per variante se ce n'è più di una).
 */
export function buildMenuPdf(input: {
  venueName: string;
  categories: MenuPdfCategory[];
  items: MenuPdfItem[];
}): { blob: Blob; filename: string } | null {
  const sections = input.categories
    .map((category) => ({
      category,
      items: input.items.filter((item) => item.visible && item.categoryId === category.id),
    }))
    .filter((section) => section.items.length > 0);
  if (sections.length === 0) return null;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };

  const ensure = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20);
  const title = input.venueName.trim() || 'Menù';
  const titleLines: string[] = doc.splitTextToSize(title, CONTENT_W);
  ensure(titleLines.length * 8 + 8);
  doc.text(titleLines, PAGE_W / 2, y, { align: 'center' });
  y += titleLines.length * 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text('Menù', PAGE_W / 2, y, { align: 'center' });
  y += 8;

  for (const section of sections) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20);
    const heading: string[] = doc.splitTextToSize(section.category.name, CONTENT_W);
    ensure(heading.length * 6 + 8);
    y += 4;
    doc.text(heading, MARGIN, y);
    y += heading.length * 6;
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5;

    for (const item of section.items) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      const nameLines: string[] = doc.splitTextToSize(item.name, CONTENT_W);
      const description = item.description?.trim() ?? '';
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      const descLines: string[] = description ? doc.splitTextToSize(description, CONTENT_W) : [];
      const prices = item.variants.length > 0 ? item.variants : [{ name: '', price: null }];
      const block = nameLines.length * 5 + descLines.length * 4.2 + prices.length * 5 + 3;
      ensure(block);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(nameLines, MARGIN, y);
      y += nameLines.length * 5;

      if (descLines.length > 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(descLines, MARGIN, y);
        y += descLines.length * 4.2;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(20);
      for (const variant of prices) {
        const label = variant.name.trim();
        const price = formatMenuPrice(variant.price);
        if (label) doc.text(label, MARGIN, y);
        doc.text(price, PAGE_W - MARGIN, y, { align: 'right' });
        y += 5;
      }
      y += 3;
    }
  }

  return { blob: doc.output('blob'), filename: filename(input.venueName) };
}

export async function saveMenuPdf(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
