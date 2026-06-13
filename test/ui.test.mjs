// 前端纯逻辑：渲染层（假容器）+ 历史持久化（localStorage 垫片）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage 垫片（history.js 在调用时才访问，模块顶层设置即可）
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const { renderResult } = await import('../public/js/render.js');
const history = await import('../public/js/history.js');

const result = {
  video_summary: 'x',
  style: { overall: 'a' },
  meta: { duration: 6 },
  shots: [
    { shot_number: 1, start: '0:00', duration_sec: 3, shot_size: '特写', movement: '固定', visual: 'V', on_screen_text: '买', audio: 'BGM' },
    { shot_number: 2, start: '0:03', duration_sec: 3, shot_size: '中景', movement: '推', visual: 'W', on_screen_text: '', audio: '旁白' }
  ]
};

test('renderResult: 必需列 + 行结构 + 画面文字列', () => {
  const c = { innerHTML: '' };
  renderResult(result, c);
  const h = c.innerHTML;
  assert.match(h, />画面文字<\/th>/);
  assert.equal((h.match(/class="shot-row"/g) || []).length, 2);
  assert.match(h, /data-thumb="0"/);
  assert.match(h, /data-row="0"/);
  assert.match(h, /id="galleryView"/);
});

test('renderResult: ARIA（表格/可编辑单元格/seek 按钮/视图 aria-pressed）', () => {
  const c = { innerHTML: '' };
  renderResult(result, c);
  const h = c.innerHTML;
  assert.match(h, /aria-label="分镜镜头脚本，可编辑"/);
  assert.match(h, /contenteditable="true" aria-label="镜头1 画面内容，可编辑"/);
  assert.doesNotMatch(h, /role="textbox"/); // 去掉了不精确的 role
  assert.match(h, /role="button" aria-label="跳转到镜头1/);
  assert.doesNotMatch(h, /col-no seek/); // 镜号不再可交互（避免 aria-hidden+可交互矛盾）
  assert.match(h, /data-view="gallery" aria-pressed="false"/);
  assert.match(h, /aria-pressed="false">特写</); // 景别 chip
});

test('renderResult: data-start 累计（shot2 接 shot1 end）', () => {
  const c = { innerHTML: '' };
  renderResult(result, c);
  assert.match(c.innerHTML, /data-start="0"/);
  assert.match(c.innerHTML, /data-start="3"/);
});

test('history: 保存返回 {id,saved}、倒序、剔除 transcript、按 id 载入', () => {
  history.clearHistory();
  const ret = history.saveResult({ shots: [{ shot_number: 1 }], transcript: 'X'.repeat(3000), video_summary: 's' }, { filename: 'a.mp4', engine: 'Gemini' });
  assert.equal(typeof ret.id, 'string');
  assert.equal(ret.saved, true);
  const loaded = history.loadResult(ret.id);
  assert.equal(loaded.transcript, undefined); // 历史快照剔除转写
  assert.equal(loaded.video_summary, 's');
  history.saveResult({ shots: [{}, {}] }, { filename: 'b.mp4' });
  assert.equal(history.listHistory()[0].filename, 'b.mp4'); // 最新在前
});

test('history: 删除 + 封顶 10 条', () => {
  history.clearHistory();
  const ids = [];
  for (let i = 0; i < 13; i++) ids.push(history.saveResult({ shots: [] }, { filename: 'f' + i }).id);
  assert.equal(history.listHistory().length, 10);
  const first = history.listHistory()[0].id;
  history.deleteResult(first);
  assert.equal(history.listHistory().find((e) => e.id === first), undefined);
  assert.equal(history.loadResult('nope'), null);
});
