// 结果展示与交互：渲染、缩略图渐进填充、跳转、视图切换、筛选、就地编辑、导出。
import { toast, baseName, nowStamp, download, computeShotTimes } from './util.js';
import { els, state } from './ui-state.js';
import { renderResult } from './render.js';
import { captureThumbnails } from './thumbs.js';
import { toMarkdown, toCSV, toJSON, toSRT, buildReplicationPrompt } from './exporters.js';
import { shotMatches } from './logic.js';

export function showResult(result) {
  state.viewGen++;
  state.resultMatchesPreview = true; // 刚分析的就是当前 #preview 视频
  els.empty.hidden = true;
  els.resultBody.hidden = false;
  els.exportBar.hidden = false;
  renderResult(result, els.resultBody);
  fillThumbnails(result, state.viewGen); // 异步填充，不阻塞结果展示
}

// 从历史载入：不抽缩略图（原视频可能已不在），提示需重新上传以联动
export function showResultFromHistory(result) {
  state.resultMatchesPreview = false; // 历史结果与当前 #preview 视频未必一致，禁止跳转
  els.empty.hidden = true;
  els.resultBody.hidden = false;
  els.exportBar.hidden = false;
  renderResult(result, els.resultBody);
  toast('已载入历史结果（缩略图与跳转需重新上传同一视频）');
}

// 按镜头起始时间抽取缩略图，渐进填进分镜表与画廊。gen 用于作废过期填充。
async function fillThumbnails(result, gen) {
  state.currentThumbs = [];
  const fileAtStart = state.currentFile;
  if (!fileAtStart || !Array.isArray(result.shots) || !result.shots.length) return;
  const times = computeShotTimes(result.shots, result.meta?.duration);
  const stale = () => gen !== state.viewGen || state.currentFile !== fileAtStart;

  setThumbsLoading(true); // 抽帧期间显示加载脉冲
  try {
    state.currentThumbs = await captureThumbnails(fileAtStart, times, {
      maxDim: 200,
      signal: state.abortController?.signal,
      onFrame: (i, url) => { // 逐张出现
        if (stale()) return;
        if (url) applyOneThumb(i, url);
        else clearThumbLoading(i);
      }
    });
  } catch {
    if (!stale()) setThumbsLoading(false);
    return; // 缩略图失败/取消不影响主结果
  }
  if (stale()) return;
  setThumbsLoading(false); // 清掉任何残留脉冲（失败帧）
}

function thumbEls(i) {
  return [`.thumb[data-thumb="${i}"]`, `.gthumb[data-gthumb="${i}"]`]
    .map((sel) => els.resultBody.querySelector(sel))
    .filter(Boolean);
}
function applyOneThumb(i, url) {
  for (const el of thumbEls(i)) {
    el.style.backgroundImage = `url(${url})`;
    el.classList.add('has-img');
    el.classList.remove('loading');
  }
}
function clearThumbLoading(i) {
  for (const el of thumbEls(i)) el.classList.remove('loading');
}
function setThumbsLoading(on) {
  els.resultBody.querySelectorAll('.thumb, .gthumb').forEach((el) => {
    el.classList.toggle('loading', on && !el.classList.contains('has-img'));
  });
}

// 点击镜头 → 视频跳转到该时刻播放并高亮
function seekTo(row) {
  const t = parseFloat(row.dataset.start);
  if (!Number.isFinite(t)) return;
  if (!els.preview.src) { toast('请先上传视频'); return; }
  if (!state.resultMatchesPreview) { toast('该结果来自历史，请重新上传同一视频后再跳转'); return; }
  els.preview.currentTime = t;
  els.preview.play?.().catch(() => {});
  els.resultBody.querySelectorAll('.shot-row.active, .shot-card.active').forEach((r) => r.classList.remove('active'));
  row.classList.add('active');
  els.preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function onResultClick(e) {
  const copyBtn = e.target.closest('[data-action="copy-recreate"]');
  if (copyBtn) {
    if (state.lastResult) {
      navigator.clipboard.writeText(buildReplicationPrompt(state.lastResult))
        .then(() => toast('复刻提示词已复制到剪贴板'))
        .catch(() => toast('复制失败'));
    }
    return;
  }
  const vt = e.target.closest('.vt');
  if (vt) { setView(vt.dataset.view); return; }

  const chip = e.target.closest('.szchip');
  if (chip) {
    chip.classList.toggle('active');
    chip.setAttribute('aria-pressed', String(chip.classList.contains('active')));
    applyFilter();
    return;
  }

  // 跳转：画廊里整张卡片(.shot-card)，表格里仅缩略图/镜号(.seek→所属 .shot-row)
  const card = e.target.closest('.shot-card');
  if (card) { seekTo(card); return; }
  if (e.target.closest('.seek')) {
    const row = e.target.closest('.shot-row');
    if (row) seekTo(row);
  }
}

export function onResultKeydown(e) {
  const el = e.target;
  if (e.key === 'Escape' && el.isContentEditable) { el.blur(); return; } // 退出编辑
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (el.isContentEditable) return; // 可编辑单元格里回车/空格为正常输入
  if (el.classList?.contains('seek')) {
    e.preventDefault();
    const row = el.closest('.shot-row');
    if (row) seekTo(row);
  } else if (el.classList?.contains('shot-card')) {
    e.preventDefault();
    seekTo(el);
  }
}

export function onResultInput(e) {
  if (e.target.id === 'shotSearch') { applyFilter(); return; }
  onResultEdit(e);
}

function setView(view) {
  const table = els.resultBody.querySelector('#tableView');
  const gallery = els.resultBody.querySelector('#galleryView');
  if (!table || !gallery) return;
  const isGallery = view === 'gallery';
  table.hidden = isGallery;
  gallery.hidden = !isGallery;
  els.resultBody.querySelectorAll('.vt').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// 关键词 + 景别筛选：仅隐藏不重排，data-row/data-card 索引不变，编辑同步安全
function applyFilter() {
  const result = state.lastResult;
  if (!result || !Array.isArray(result.shots)) return;
  const search = els.resultBody.querySelector('#shotSearch');
  const kw = (search?.value || '').trim().toLowerCase();
  const activeSizes = [...els.resultBody.querySelectorAll('.szchip.active')].map((b) => b.dataset.size);
  let visible = 0;
  result.shots.forEach((s, i) => {
    const show = shotMatches(s, kw, activeSizes);
    if (show) visible++;
    const row = els.resultBody.querySelector(`.shot-row[data-row="${i}"]`);
    const card = els.resultBody.querySelector(`.shot-card[data-card="${i}"]`);
    if (row) row.style.display = show ? '' : 'none';
    if (card) card.style.display = show ? '' : 'none';
  });
  const label = els.resultBody.querySelector('#shotCount');
  if (label) {
    label.textContent = visible === result.shots.length
      ? `共 ${visible} 个镜头`
      : `筛选出 ${visible} / ${result.shots.length} 个镜头`;
  }
}

// 就地编辑分镜文字 → 同步回 lastResult（导出随之更新）
function onResultEdit(e) {
  const cell = e.target.closest('[data-field]');
  const result = state.lastResult;
  if (!cell || !result || !Array.isArray(result.shots)) return;
  const i = Number(cell.dataset.i);
  const field = cell.dataset.field;
  if (result.shots[i] && field) {
    result.shots[i][field] = cell.textContent.trim();
  }
}

export function handleExport(kind) {
  const result = state.lastResult;
  if (!result) return;
  const name = `${baseName(state.lastExportMeta?.filename)}_拉片_${nowStamp()}`;
  if (kind === 'md') {
    navigator.clipboard.writeText(toMarkdown(result, state.lastExportMeta))
      .then(() => toast('Markdown 已复制到剪贴板'))
      .catch(() => toast('复制失败，请改用下载'));
  } else if (kind === 'md-file') {
    download(`${name}.md`, toMarkdown(result, state.lastExportMeta), 'text/markdown;charset=utf-8');
  } else if (kind === 'csv') {
    download(`${name}.csv`, toCSV(result), 'text/csv;charset=utf-8');
  } else if (kind === 'json') {
    download(`${name}.json`, toJSON(result), 'application/json;charset=utf-8');
  } else if (kind === 'srt') {
    const srt = toSRT(result);
    if (!srt) { toast('无可导出的字幕'); return; }
    download(`${name}.srt`, srt, 'application/x-subrip;charset=utf-8');
  }
}
