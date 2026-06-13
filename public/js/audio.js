// 从视频文件中提取音频 → 重采样为 16kHz 单声道 WAV，并按时长分段（规避转写服务的单文件大小限制）。
// 全部在浏览器本地完成；无音轨 / 解码失败时返回 null，由上层优雅降级。

import { abortError } from './util.js';

const TARGET_RATE = 16000; // Whisper 推荐采样率

export async function extractAudioSegments(file, { segmentSec = 600, maxMinutes = 60, onProgress, signal } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC || !OAC) return null;
  if (signal?.aborted) throw abortError();

  let arrayBuf;
  try {
    arrayBuf = await file.arrayBuffer();
  } catch {
    return null;
  }

  const ac = new AC();
  let decoded;
  try {
    decoded = await decode(ac, arrayBuf);
  } catch {
    safeClose(ac);
    return null; // 无音轨或编码不支持
  }
  safeClose(ac);

  if (!decoded || !decoded.duration || decoded.numberOfChannels === 0) return null;
  if (decoded.duration > maxMinutes * 60) {
    // 过长：仍尝试，但提示上层可能较慢（不截断，交由分段处理）
  }

  // 重采样为 16k 单声道
  let rendered;
  try {
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OAC(1, frames, TARGET_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    rendered = await offline.startRendering();
  } catch {
    if (signal?.aborted) throw abortError(); // 取消要传播，而非当作“无音轨”
    return null;
  }

  if (signal?.aborted) throw abortError();
  const data = rendered.getChannelData(0); // Float32Array, mono, 16k
  if (isSilent(data)) return { segments: [], duration: decoded.duration, silent: true };

  const segments = [];
  const segSamples = Math.max(1, Math.floor(segmentSec * TARGET_RATE));
  const total = data.length;
  let idx = 0;
  const segCount = Math.ceil(total / segSamples);
  for (let start = 0; start < total; start += segSamples) {
    const end = Math.min(total, start + segSamples);
    const slice = data.subarray(start, end);
    segments.push({ blob: encodeWav(slice, TARGET_RATE), offset: start / TARGET_RATE });
    onProgress?.(++idx, segCount);
  }

  return { segments, duration: decoded.duration, silent: false };
}

// 把带（已加全局偏移的）时间戳的分段拼成可读转写文本，供分析模型参考。
export function formatTranscript(segments) {
  return segments
    .filter((s) => s.text && s.text.trim())
    .map((s) => `[${ts(s.start)}–${ts(s.end)}] ${s.text.trim()}`)
    .join('\n');
}

function ts(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function decode(ac, arrayBuf) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b) => { if (!settled) { settled = true; resolve(b); } };
    const err = (e) => { if (!settled) { settled = true; reject(e || new Error('decodeAudioData 失败')); } };
    let p;
    try {
      p = ac.decodeAudioData(arrayBuf, ok, err);
    } catch (e) {
      err(e);
      return;
    }
    if (p && typeof p.then === 'function') p.then(ok, err);
  });
}

function isSilent(data) {
  // 抽样检测能量，避免逐样本遍历巨大数组
  const step = Math.max(1, Math.floor(data.length / 20000));
  let peak = 0;
  for (let i = 0; i < data.length; i += step) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  return peak < 0.005;
}

function encodeWav(float32, sampleRate) {
  const n = float32.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeStr(view, 36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = float32[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function safeClose(ac) {
  try { ac.close(); } catch { /* ignore */ }
}
