// 从 main.js 拆分时提取出的纯领域逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTranscribeKey, shotMatches, fmtDate } from '../public/js/logic.js';

test('resolveTranscribeKey: 显式 > 同源复用 > 已存 Key', () => {
  // 显式填写优先
  assert.equal(resolveTranscribeKey({ explicitKey: ' k1 ', engineProvider: 'openai', analysisProvider: 'claude', analysisKey: 'a', storedKey: 's' }), 'k1');
  // 空显式 + 同源 → 复用分析 Key
  assert.equal(resolveTranscribeKey({ explicitKey: '', engineProvider: 'openai', analysisProvider: 'openai', analysisKey: 'akey', storedKey: 's' }), 'akey');
  // 空显式 + 异源 → 用已存 Key
  assert.equal(resolveTranscribeKey({ explicitKey: '', engineProvider: 'gemini', analysisProvider: 'claude', analysisKey: 'akey', storedKey: 'gkey' }), 'gkey');
  // 都没有 → ''
  assert.equal(resolveTranscribeKey({ explicitKey: '', engineProvider: 'gemini', analysisProvider: 'claude', analysisKey: '', storedKey: '' }), '');
});

test('shotMatches: 关键词命中各字段 + 景别筛选 + 组合', () => {
  const shot = { shot_number: 3, shot_size: '特写', movement: '推', visual: '咖啡杯', on_screen_text: '立即购买', audio: '钢琴' };
  assert.equal(shotMatches(shot, '', []), true);           // 无条件
  assert.equal(shotMatches(shot, '咖啡', []), true);        // 命中 visual
  assert.equal(shotMatches(shot, '购买', []), true);        // 命中 on_screen_text
  assert.equal(shotMatches(shot, '钢琴', []), true);        // 命中 audio
  assert.equal(shotMatches(shot, '航拍', []), false);       // 不命中
  assert.equal(shotMatches(shot, '', ['特写']), true);      // 景别命中
  assert.equal(shotMatches(shot, '', ['全景']), false);     // 景别不命中
  assert.equal(shotMatches(shot, '咖啡', ['全景']), false); // 组合：关键词中但景别不中
});

test('fmtDate: 月-日 时:分 补零', () => {
  assert.equal(fmtDate(new Date(2026, 5, 14, 9, 5).getTime()), '6-14 09:05');
  assert.equal(fmtDate(new Date(2026, 11, 1, 23, 9).getTime()), '12-01 23:09');
});
