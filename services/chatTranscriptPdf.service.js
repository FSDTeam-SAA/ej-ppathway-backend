import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 52;
const FOOTER_HEIGHT = 30;
const CONTENT_BOTTOM = MARGIN + FOOTER_HEIGHT;

// pdf-lib's built-in Helvetica font uses WinAnsi. Normalize common punctuation
// and replace unsupported glyphs so user-entered emoji/Unicode never crashes export.
const pdfSafeText = (value) => String(value ?? '')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

const formatDate = (value, includeTime = true) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {})
  }).format(date);
};

const splitLongWord = (word, maxWidth, font, size) => {
  const chunks = [];
  let chunk = '';
  for (const char of word) {
    const next = `${chunk}${char}`;
    if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = next;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
};

const wrapText = (value, maxWidth, font, size) => {
  const paragraphs = pdfSafeText(value).replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const rawWord of paragraph.trim().split(/\s+/)) {
      const words = font.widthOfTextAtSize(rawWord, size) > maxWidth
        ? splitLongWord(rawWord, maxWidth, font, size)
        : [rawWord];
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
};

export const buildChatTranscriptPdf = async ({ session, messages, generatedAt = new Date() }) => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = rgb(0.055, 0.455, 0.565);
  const ink = rgb(0.13, 0.15, 0.18);
  const muted = rgb(0.4, 0.43, 0.48);
  const lineColor = rgb(0.86, 0.88, 0.91);

  let page;
  let y;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (height) => {
    if (y - height < CONTENT_BOTTOM) addPage();
  };

  const drawLines = (lines, { x = MARGIN, size = 10.5, font = regular, color = ink, gap = 14 } = {}) => {
    for (const line of lines) {
      ensureSpace(gap);
      if (line) page.drawText(line, { x, y, size, font, color });
      y -= gap;
    }
  };

  addPage();
  page.drawText('Prophetic Pathway', { x: MARGIN, y, size: 20, font: bold, color: brand });
  y -= 27;
  page.drawText('Session Chat Transcript', { x: MARGIN, y, size: 15, font: bold, color: ink });
  y -= 25;

  const metadata = [
    ['Session', session.sessionCode || String(session._id)],
    ['Type', session.type === 'chat' ? 'Text Chat' : String(session.type || '')],
    ['User', session.user?.name || 'User'],
    ['Advisor', session.advisor?.name || 'Advisor'],
    ['Session Date', formatDate(session.startedAt || session.scheduledFor || session.createdAt)],
    ['Generated At', formatDate(generatedAt)]
  ];
  for (const [label, value] of metadata) {
    ensureSpace(17);
    page.drawText(`${pdfSafeText(label)}:`, { x: MARGIN, y, size: 10, font: bold, color: muted });
    const valueLines = wrapText(value, contentWidth - 105, regular, 10);
    valueLines.forEach((line, index) => {
      page.drawText(line, { x: MARGIN + 105, y: y - index * 13, size: 10, font: regular, color: ink });
    });
    y -= Math.max(17, valueLines.length * 13 + 4);
  }

  ensureSpace(25);
  page.drawLine({
    start: { x: MARGIN, y: y - 3 },
    end: { x: PAGE_WIDTH - MARGIN, y: y - 3 },
    thickness: 1,
    color: lineColor
  });
  y -= 24;

  if (!messages.length) {
    drawLines(['No messages were sent during this session.'], { color: muted, size: 11 });
  }

  for (const message of messages) {
    const sender = message.sender?.name || 'Unknown participant';
    const heading = `[${formatDate(message.createdAt)}] ${sender}`;
    const bodyLines = wrapText(message.text || '', contentWidth, regular, 10.5);
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const required = 20 + Math.min(bodyLines.length, 3) * 14;
    ensureSpace(required);
    drawLines([pdfSafeText(heading)], { font: bold, size: 10.5, color: brand, gap: 16 });
    if (message.text) drawLines(bodyLines, { size: 10.5, gap: 14 });
    if (attachments.length) {
      drawLines(['Attachments:'], { font: bold, size: 9.5, color: muted, gap: 13 });
      for (const attachment of attachments) {
        drawLines(wrapText(attachment, contentWidth - 12, regular, 9), {
          x: MARGIN + 12,
          size: 9,
          color: muted,
          gap: 12
        });
      }
    }
    y -= 10;
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `Prophetic Pathway - Confidential - Page ${index + 1} of ${pages.length}`;
    const width = regular.widthOfTextAtSize(footer, 8);
    pdfPage.drawLine({
      start: { x: MARGIN, y: MARGIN },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN },
      thickness: 0.7,
      color: lineColor
    });
    pdfPage.drawText(footer, {
      x: (PAGE_WIDTH - width) / 2,
      y: MARGIN - 17,
      size: 8,
      font: regular,
      color: muted
    });
  });

  pdf.setTitle(`Session Chat Transcript - ${session.sessionCode || session._id}`);
  pdf.setAuthor('Prophetic Pathway');
  pdf.setCreator('Prophetic Pathway');
  pdf.setCreationDate(generatedAt);
  return Buffer.from(await pdf.save());
};

export default { buildChatTranscriptPdf };
