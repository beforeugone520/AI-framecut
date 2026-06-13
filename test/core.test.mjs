// 核心容错逻辑：JSON 解析/归一化 + 时间轴/工具函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractJson, normalizeResult } from '../lib/json.js';
import { parseTimecode, computeShotTimes, friendlyError, escAttr, mapLimit, abortError } from '../public/js/util.js';

test('extractJson: 代码围栏 / 前缀文字 / 尾逗号', () => {
  assert.equal(extractJson('```json\n{"x":1}\n```').x, 1);
  assert.equal(extractJson('结果：\n{"a":1,}').a, 1);
  assert.deepEqual(extractJson('{"b":[1,2,],}').b, [1, 2]);
});

test('extractJson: 字段值/尾随文本含 } 不截错（括号配对扫描）', () => {
  // 字段值里有 }，且 JSON 后面跟了含 } 的解释文字
  const raw = '{"note":"用 {大括号} 包裹","n":2} 以上就是结果}}}';
  const o = extractJson(raw);
  assert.equal(o.n, 2);
  assert.equal(o.note, '用 {大括号} 包裹');
});

test('extractJson: 嵌套对象', () => {
  const o = extractJson('prefix {"a":{"b":{"c":3}}} suffix');
  assert.equal(o.a.b.c, 3);
});

test('extractJson: 空/无法解析时抛错', () => {
  assert.throws(() => extractJson(null));
  assert.throws(() => extractJson('完全没有 JSON'));
});

test('normalizeResult: 中英文 key + 时长反推 + on_screen_text', () => {
  const n = normalizeResult({
    画面风格: { 整体: '电影感', 复刻要点: '大光圈' },
    分镜: [
      { 镜号: 1, 起始: '0:00', 结束: '0:04', 景别: '中景', 字幕: '立即购买' },
      { shot_number: 2, start: '0:04', end: '0:09', on_screen_text: '限时5折', duration_sec: 5 }
    ]
  });
  assert.equal(n.style.overall, '电影感');
  assert.equal(n.style.replication_tips, '大光圈');
  assert.equal(n.shots[0].duration_sec, 4); // 由起止反推
  assert.equal(n.shots[0].on_screen_text, '立即购买');
  assert.equal(n.shots[1].on_screen_text, '限时5折');
});

test('parseTimecode: 多种形式', () => {
  assert.equal(parseTimecode('1:30'), 90);
  assert.equal(parseTimecode('1:02:03'), 3723);
  assert.equal(parseTimecode('12.5'), 12.5);
  assert.equal(parseTimecode(7), 7);
  assert.equal(parseTimecode(''), null);
  assert.equal(parseTimecode('abc'), null);
});

test('computeShotTimes: 回归 + 不变量（单调 / 缺时长前进 / clamp）', () => {
  assert.deepEqual(
    computeShotTimes([{ start: '0:00', end: '0:03', duration_sec: 3 }, { duration_sec: 2 }, { start: '0:08', duration_sec: 4 }], 20),
    [0, 3, 8]
  );
  assert.equal(computeShotTimes([{ start: '0:30' }], 3)[0], 3); // clamp
  const dup = computeShotTimes([{ duration_sec: 2 }, {}, { duration_sec: 1 }]);
  assert.notEqual(dup[1], dup[2]); // 缺时长不重复起点
  const mono = computeShotTimes([{ start: '10' }, { start: '5' }, { start: '15' }], 100);
  assert.ok(mono[1] >= mono[0] && mono[2] >= mono[1]); // 单调不减
});

test('friendlyError: 分类常见错误 + 超时 + 未知原样', () => {
  assert.match(friendlyError('X (401): invalid x-api-key'), /API Key/);
  assert.match(friendlyError('X (429): Rate limit'), /限流/);
  assert.match(friendlyError('Gemini (404): models/foo is not found'), /模型/);
  assert.match(friendlyError('请求超时（超过 360 秒）'), /超时/);
  assert.equal(friendlyError('某个未知错误'), '某个未知错误');
});

test('escAttr: 转义引号与尖括号', () => {
  assert.equal(escAttr('a"b'), 'a&quot;b');
  assert.equal(escAttr(`a'b`), 'a&#39;b');
  assert.equal(escAttr('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

test('mapLimit: 保序 + 处理全部', async () => {
  const r = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => x * 2);
  assert.deepEqual(r, [2, 4, 6, 8, 10]);
});

test('abortError: name 为 AbortError', () => {
  assert.equal(abortError().name, 'AbortError');
});
