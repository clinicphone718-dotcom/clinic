import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessageUrl, normalizeMessagePhone, renderMessageTemplate } from './messages';

test('message phone normalization strips punctuation and adds the configured country prefix', () => {
  assert.equal(normalizeMessagePhone('22 123 456'), '21622123456');
  assert.equal(normalizeMessagePhone('0 22-123-456'), '21622123456');
  assert.equal(normalizeMessagePhone('+33 6 12 34 56 78'), '33612345678');
  assert.equal(normalizeMessagePhone('00 216 22 123 456'), '21622123456');
  assert.equal(normalizeMessagePhone('0612345678', '33'), '33612345678');
  assert.equal(normalizeMessagePhone('---'), '');
  assert.equal(normalizeMessagePhone('123'), '');
});

test('message templates substitute every supported variable', () => {
  assert.equal(
    renderMessageTemplate(
      '{client}|{appareil}|{numero}|{montant_restant}|{nom_magasin}',
      { client: 'Sami', appareil: 'iPhone', numero: 'REP-1', montant_restant: '20 DT', nom_magasin: 'Clinique' },
    ),
    'Sami|iPhone|REP-1|20 DT|Clinique',
  );
});

test('message links use WhatsApp and SMS schemes with encoded text', () => {
  assert.equal(
    buildMessageUrl('WhatsApp', '21622123456', 'Bonjour Sami'),
    'https://wa.me/21622123456?text=Bonjour%20Sami',
  );
  assert.equal(
    buildMessageUrl('SMS', '21622123456', 'Réparation prête'),
    `sms:21622123456?body=${encodeURIComponent('Réparation prête')}`,
  );
});
