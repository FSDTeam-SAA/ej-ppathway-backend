import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import { buildChatTranscriptPdf } from '../services/chatTranscriptPdf.service.js';

const session = {
  _id: 'session-id',
  sessionCode: 'SES-123456',
  type: 'chat',
  user: { name: 'Test User' },
  advisor: { name: 'Test Advisor' },
  createdAt: new Date('2026-01-02T10:00:00Z')
};

test('creates a valid PDF for an empty chat', async () => {
  const bytes = await buildChatTranscriptPdf({ session, messages: [] });
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
});

test('wraps long content, creates pages, and tolerates unsupported Unicode', async () => {
  const messages = Array.from({ length: 90 }, (_, index) => ({
    sender: { name: index % 2 ? 'Advisor ✨' : 'User 👋' },
    text: `${'A-very-long-unbroken-token'.repeat(12)} Message ${index} — “safe”`,
    attachments: index % 5 === 0 ? [`https://example.com/files/${index}`] : [],
    createdAt: new Date(Date.UTC(2026, 0, 2, 10, index))
  }));
  const bytes = await buildChatTranscriptPdf({ session, messages });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
});
