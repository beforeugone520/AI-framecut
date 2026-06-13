// 视频元数据读取 + 按时间戳抽取关键帧（用于 Claude / OpenAI 抽帧模式）。
import { abortError } from './util.js';

export function loadVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        objectUrl: video.src // 调用方成功后接管，负责后续 revoke
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src); // 失败路径释放，避免泄漏
      reject(new Error('无法读取该视频，请换一个文件或格式'));
    };
  });
}

// 抽帧：返回 [{ time, dataUrl }]，maxDim 控制帧分辨率，onProgress(i, total)，signal 支持取消
export async function extractFrames(file, { maxFrames = 48, maxDim = 640, onProgress, signal } = {}) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);

  // 用 finally 统一释放 ObjectURL：无论解码失败、抽帧抛错、取消还是正常结束都不泄漏
  try {
    return await doExtract(video, { maxFrames, maxDim, onProgress, signal });
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

async function doExtract(video, { maxFrames, maxDim, onProgress, signal }) {
  await once(video, 'loadeddata', 'error', '无法解码视频用于抽帧');

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('视频时长无效，无法抽帧');
  }

  // 采样数量：约每 1.5s 一帧，限制上下界
  let count = Math.round(duration / 1.5);
  count = Math.max(4, Math.min(maxFrames, count));

  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const cw = Math.max(2, Math.round(vw * scale));
  const ch = Math.max(2, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false });

  const frames = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw abortError();
    // 在每个区间中点取帧，避免取到纯黑首帧
    const t = Math.min(duration - 0.05, ((i + 0.5) / count) * duration);
    await seek(video, t);
    ctx.drawImage(video, 0, 0, cw, ch);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    frames.push({ time: t, dataUrl });
    onProgress?.(i + 1, count);
  }

  return frames; // ObjectURL 由 extractFrames 的 finally 释放
}

function seek(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      // 等一帧确保画面已绘制
      requestAnimationFrame(() => resolve());
    };
    const onErr = () => {
      cleanup();
      reject(new Error('抽帧定位失败'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onErr);
      clearTimeout(timer);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onErr);
    const timer = setTimeout(onSeeked, 3000); // 兜底
    try {
      video.currentTime = time;
    } catch {
      onErr();
    }
  });
}

function once(el, okEvent, errEvent, errMsg) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error(errMsg)); };
    const cleanup = () => {
      el.removeEventListener(okEvent, ok);
      el.removeEventListener(errEvent, err);
    };
    el.addEventListener(okEvent, ok);
    el.addEventListener(errEvent, err);
  });
}
