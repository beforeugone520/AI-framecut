// 导出：Markdown / CSV / SRT / 复刻提示词。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toMarkdown, toCSV, toSRT, buildReplicationPrompt } from '../public/js/exporters.js';

const sample = {
  video_summary: '咖啡产品片',
  style: { overall: '干净商业感', replication_tips: '85mm 大光圈' },
  meta: { duration: 5 },
  shots: [
    { shot_number: 1, start: '0:00', duration_sec: 2, shot_size: '特写', movement: '固定', visual: '咖啡杯 | 蒸汽', on_screen_text: '标题X', audio: 'BGM' },
    { shot_number: 2, start: '0:02', duration_sec: 3, shot_size: '中景', movement: '推', visual: '人物', on_screen_text: '', audio: '旁白' }
  ]
};

test('toMarkdown: 含画面文字列 + 管道符转义 + 复刻要点', () => {
  const md = toMarkdown(sample, {});
  assert.match(md, /\| 镜号 \| 景别\/角度 \| 运动 \| 画面内容 \| 画面文字 \| 音频 \| 时长\(秒\) \|/);
  assert.match(md, /咖啡杯 \\\| 蒸汽/); // 管道符转义
  assert.match(md, /标题X/);
  assert.match(md, /🎯 复刻要点/);
});

test('toCSV: 含 BOM 与画面文字表头', () => {
  const csv = toCSV(sample);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /镜号,景别\/角度,运动,画面内容,画面文字,音频/);
});

test('toSRT: 时间码合法、序号、画面文字、镜头信息', () => {
  const srt = toSRT(sample);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000/);
  assert.match(srt, /00:00:02,000 --> 00:00:05,000/); // 末镜头用总时长
  assert.match(srt, /字：标题X/);
  assert.match(srt, /#1 · 特写 · 固定/);
});

test('toSRT: 毫秒进位不产生非法 4 位毫秒', () => {
  const r = { meta: { duration: 10 }, shots: [{ shot_number: 1, start: '0', duration_sec: 0.9995, visual: 'x' }, { shot_number: 2, duration_sec: 1, visual: 'y' }] };
  const srt = toSRT(r);
  assert.doesNotMatch(srt, /,\d{4}/);
  // 所有时间码分量合法
  for (const m of srt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)) {
    assert.ok(+m[2] < 60 && +m[3] < 60 && +m[4] < 1000);
  }
});

test('toSRT: 空 shots 返回空串', () => {
  assert.equal(toSRT({ shots: [] }), '');
});

test('buildReplicationPrompt: 含风格 + 分镜节奏 + 画面文字', () => {
  const rp = buildReplicationPrompt(sample);
  assert.match(rp, /【视频复刻提示词】/);
  assert.match(rp, /整体风格：干净商业感/);
  assert.match(rp, /1\. \[特写·固定\]/);
  assert.match(rp, /（画面文字：标题X）/);
});
