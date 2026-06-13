// 按给定时间点从视频抽取镜头缩略图（用于可视化分镜表）。
// 与抽帧分析独立：无论 Gemini 原生模式还是抽帧模式，只要原视频还在浏览器里就能用。
import { abortError } from './util.js';

export async function captureThumbnails(file, times, { maxDim = 200, quality = 0.6, onProgress, signal } = {}) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);

  try {
    await once(video, 'loadeddata', 'error');
  } catch {
    URL.revokeObjectURL(video.src);
    return times.map(() => null);
  }

  const duration = video.duration;
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const cw = Math.max(2, Math.round(vw * scale));
  const ch = Math.max(2, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false });

  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) { URL.revokeObjectURL(video.src); throw abortError(); }
    let t = times[i];
    if (!Number.isFinite(t)) t = 0;
    if (Number.isFinite(duration)) t = Math.max(0, Math.min(duration - 0.05, t));
    try {
      await seek(video, t);
      ctx.drawImage(video, 0, 0, cw, ch);
      out.push(canvas.toDataURL('image/jpeg', quality));
    } catch {
      out.push(null);
    }
    onProgress?.(i + 1, times.length);
  }

  URL.revokeObjectURL(video.src);
  return out;
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); requestAnimationFrame(() => resolve()); };
    const onErr = () => { cleanup(); reject(new Error('seek failed')); };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onErr);
    const timer = setTimeout(onSeeked, 3000);
    try { video.currentTime = time; } catch { onErr(); }
  });
}

function once(el, okEvent, errEvent) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error('load failed')); };
    const cleanup = () => {
      el.removeEventListener(okEvent, ok);
      el.removeEventListener(errEvent, err);
    };
    el.addEventListener(okEvent, ok);
    el.addEventListener(errEvent, err);
  });
}
