import assert from 'node:assert/strict';
import test from 'node:test';
import { adhkarLibrary } from './adhkar';
import { verses } from './verses';
import { isDirectAudioUrl } from '../lib/startup';

test('startup verse library contains at least 30 source-referenced Uthmani verses', () => {
  assert.ok(verses.length >= 30);
  for (const verse of verses) {
    assert.ok(verse.text.trim());
    assert.match(verse.source, /\d+:\d+$/);
  }
});

test('morning and evening library includes the requested verified adhkar', () => {
  for (const section of ['matin', 'soir'] as const) {
    const items = adhkarLibrary.filter((item) => item.section === section);
    assert.ok(items.some((item) => item.title === 'آية الكرسي'));
    assert.ok(items.some((item) => item.repeat === 3));
    assert.ok(items.some((item) => item.title.includes('الملك')));
    assert.ok(items.some((item) => item.title === 'سيد الاستغفار'));
    assert.ok(items.some((item) => item.title === 'بسم الله الذي لا يضر' && item.repeat === 3));
    assert.ok(items.some((item) => item.title === 'سبحان الله وبحمده' && item.repeat === 100));
    assert.ok(items.every((item) => item.source.startsWith('Hisn al-Muslim')));
  }
});

test('Rizq starter content is a sourced Quran verse rather than an unchecked invocation', () => {
  const rizqItem = adhkarLibrary.find((item) => item.section === 'rizq');
  assert.ok(rizqItem);
  assert.ok(rizqItem.text);
  assert.match(rizqItem.source, /Coran Uthmani.*106:4/);
});

test('direct audio links require HTTPS MP3/M4A files and reject video providers', () => {
  assert.equal(isDirectAudioUrl('https://audio.example.org/recitation.mp3'), true);
  assert.equal(isDirectAudioUrl('https://audio.example.org/recitation.m4a?download=1'), true);
  assert.equal(isDirectAudioUrl('http://audio.example.org/recitation.mp3'), false);
  assert.equal(isDirectAudioUrl('https://youtube.com/watch?v=example.mp3'), false);
  assert.equal(isDirectAudioUrl('https://youtu.be/example'), false);
  assert.equal(isDirectAudioUrl('https://audio.example.org/stream.m3u8'), false);
});
