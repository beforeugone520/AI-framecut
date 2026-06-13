import { $, fmtTime, fmtBytes, download, toast, baseName, mapLimit, friendlyError, escAttr, nowStamp } from './util.js';
import { load, save, PROVIDERS, TRANSCRIBE_ENGINES } from './store.js';
import { loadVideoMeta, extractFrames } from './extract.js';
import { extractAudioSegments, formatTranscript } from './audio.js';
import { captureThumbnails } from './thumbs.js';
import { analyzeVideo, analyzeFrames, transcribeAudio } from './api.js';
import { renderResult, computeShotTimes } from './render.js';
import { toMarkdown, toCSV, toJSON, toSRT, buildReplicationPrompt } from './exporters.js';
import { saveResult, listHistory, loadResult, deleteResult } from './history.js';

const els = {
  provider: $('#provider'),
  providerHint: $('#providerHint'),
  model: $('#model'),
  apiKey: $('#apiKey'),
  baseUrlField: $('#baseUrlField'),
  baseUrl: $('#baseUrl'),
  focus: $('#focus'),
  framesField: $('#framesField'),
  maxFrames: $('#maxFrames'),
  maxFramesVal: $('#maxFramesVal'),
  transcribeField: $('#transcribeField'),
  transcribeOn: $('#transcribeOn'),
  transcribeOpts: $('#transcribeOpts'),
  transcribeEngine: $('#transcribeEngine'),
  transcribeKey: $('#transcribeKey'),
  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
  videoMeta: $('#videoMeta'),
  preview: $('#preview'),
  metaList: $('#metaList'),
  analyzeBtn: $('#analyzeBtn'),
  status: $('#status'),
  empty: $('#empty'),
  resultBody: $('#resultBody'),
  exportBar: $('#exportBar'),
  historyBox: $('#historyBox')
};

const settings = load();
let currentFile = null;
let currentMeta = null;       // { duration, width, height }
let currentObjectUrl = null;
let lastResult = null;
let lastExportMeta = null;
let busy = false;
let viewGen = 0; // 视图代号：换视频/重新分析时自增，作废在途的缩略图填充
let currentThumbs = []; // 当前结果的缩略图 dataURL 缓存（表格与画廊共用）
let resultMatchesPreview = false; // 当前结果是否对应已载入的 #preview 视频（历史载入时为 false）
let abortController = null; // 贯穿当前分析的取消控制器

/* ── 初始化 UI ── */
function initUI() {
  els.provider.value = settings.provider;
  els.apiKey.value = settings.keys[settings.provider] || '';
  els.baseUrl.value = settings.baseUrl || '';
  els.focus.value = settings.focus || '';
  els.maxFrames.value = settings.maxFrames || 48;
  els.maxFramesVal.textContent = els.maxFrames.value;
  els.transcribeOn.checked = !!settings.transcribeOn;
  els.transcribeEngine.value = settings.transcribeEngine || 'openai';
  els.transcribeKey.value = settings.transcribeKey || '';
  applyProvider();
  applyTranscribe();
  renderHistory();
}

function applyProvider() {
  const p = els.provider.value;
  const conf = PROVIDERS[p];
  els.providerHint.textContent = conf.hint;
  els.model.value = settings.models[p] || conf.defaultModel;
  els.apiKey.value = settings.keys[p] || '';
  els.apiKey.placeholder = `粘贴 ${conf.label} API Key`;
  els.baseUrlField.hidden = !conf.needsBaseUrl;
  const isFrames = conf.mode === 'frames';
  els.framesField.style.display = isFrames ? '' : 'none';
  els.transcribeField.style.display = isFrames ? '' : 'none';
}

function applyTranscribe() {
  els.transcribeOpts.hidden = !els.transcribeOn.checked;
}

/* ── 持久化 ── */
function persist() {
  settings.provider = els.provider.value;
  settings.models[els.provider.value] = els.model.value.trim();
  settings.keys[els.provider.value] = els.apiKey.value.trim();
  settings.baseUrl = els.baseUrl.value.trim();
  settings.focus = els.focus.value.trim();
  settings.maxFrames = Number(els.maxFrames.value);
  settings.transcribeOn = els.transcribeOn.checked;
  settings.transcribeEngine = els.transcribeEngine.value;
  settings.transcribeKey = els.transcribeKey.value.trim();
  save(settings);
}

/* ── 文件处理 ── */
async function handleFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    setStatus('error', '请选择视频文件');
    return;
  }
  try {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    const meta = await loadVideoMeta(file);
    currentFile = file;
    currentMeta = { duration: meta.duration, width: meta.width, height: meta.height };
    currentObjectUrl = meta.objectUrl;

    // 换视频：取消任何在途分析/缩略图，作废旧结果，避免旧分镜行点击后跳错视频、旧缩略图错填
    if (abortController) abortController.abort();
    viewGen++;
    lastResult = null;
    els.resultBody.hidden = true;
    els.resultBody.innerHTML = '';
    els.exportBar.hidden = true;
    els.empty.hidden = false;

    els.preview.src = meta.objectUrl;
    els.metaList.innerHTML = `
      <li><span>文件名</span><b>${escAttr(file.name)}</b></li>
      <li><span>时长</span><b>${fmtTime(meta.duration)}</b></li>
      <li><span>分辨率</span><b>${meta.width}×${meta.height}</b></li>
      <li><span>大小</span><b>${fmtBytes(file.size)}</b></li>`;
    els.videoMeta.hidden = false;
    els.analyzeBtn.disabled = false;
    setStatus(null);
  } catch (err) {
    setStatus('error', err.message);
  }
}

/* ── 分析主流程 ── */
async function runAnalysis() {
  if (busy || !currentFile) return;
  persist();

  const provider = els.provider.value;
  const conf = PROVIDERS[provider];
  if (!conf) {
    setStatus('error', `不支持的分析引擎：${provider}`);
    return;
  }
  const apiKey = els.apiKey.value.trim();
  const model = els.model.value.trim() || conf.defaultModel;
  const focus = els.focus.value.trim();

  if (!apiKey) {
    setStatus('error', `请先填写 ${conf.label} API Key`);
    els.apiKey.focus();
    return;
  }

  if (abortController) abortController.abort(); // 作废上一次（理论上不会重叠，防御）
  abortController = new AbortController();
  const signal = abortController.signal;

  setBusy(true);
  try {
    let result;
    if (conf.mode === 'video') {
      setStatus('working', '正在上传视频并调用 Gemini 分析（视频较大时可能需要 1～3 分钟）…');
      result = await analyzeVideo({ file: currentFile, model, apiKey, focus, meta: currentMeta, signal });
    } else {
      setStatus('working', '正在抽取关键帧…');
      const frames = await extractFrames(currentFile, {
        maxFrames: Number(els.maxFrames.value),
        signal,
        onProgress: (i, total) => setStatus('working', `正在抽取关键帧 ${i}/${total}…`)
      });

      const transcript = els.transcribeOn.checked
        ? await runTranscription(provider, apiKey, signal)
        : '';

      setStatus('working', `已抽取 ${frames.length} 帧${transcript ? '（含真实音频转写）' : ''}，正在调用 ${conf.label} 分析…`);
      result = await analyzeFrames({
        provider, model, apiKey,
        baseUrl: els.baseUrl.value.trim(),
        frames, focus, transcript, signal,
        meta: { ...currentMeta, filename: currentFile.name }
      });
      if (transcript) result.transcript = transcript;
    }

    if (!result || !Array.isArray(result.shots) || result.shots.length === 0) {
      throw new Error('模型未返回有效的分镜数据，请重试或更换模型');
    }

    lastResult = result;
    lastExportMeta = { filename: currentFile.name, engine: `${conf.label} · ${model}` };
    showResult(result);
    try {
      const { saved } = saveResult(result, lastExportMeta);
      if (!saved) toast('本机历史空间不足，本次结果未保存到历史');
      renderHistory();
    } catch { /* 历史保存失败不影响主流程 */ }
    setStatus('done', `分析完成 · 共 ${result.shots.length} 个镜头`);
  } catch (err) {
    if (signal.aborted) {
      // 仅当本次分析的外部信号被取消时才算“已取消”（超时虽也产生 AbortError，但属于错误）
      setStatus(null);
      toast('已取消分析');
    } else {
      console.error(err);
      setStatus('error', friendlyError(err.message || String(err)));
    }
  } finally {
    setBusy(false);
  }
}

// 提取音频 → 分段转写 → 按全局偏移合并 → 返回带时间戳的转写文本
async function runTranscription(analysisProvider, analysisKey, signal) {
  const engineKey = els.transcribeEngine.value;
  const engineConf = TRANSCRIBE_ENGINES[engineKey];
  if (!engineConf) throw new Error(`不支持的音频转写引擎：${engineKey}`);

  let key = els.transcribeKey.value.trim();
  if (!key && engineConf.provider === analysisProvider) key = analysisKey;
  if (!key) key = settings.keys[engineConf.provider] || '';
  if (!key) {
    throw new Error(`音频转写需要 ${engineConf.label} 的 API Key（在「高级设置」里填写，或留空以复用同源分析 Key）`);
  }

  setStatus('working', '正在提取音频…');
  let audio = null;
  try {
    audio = await extractAudioSegments(currentFile, {
      signal,
      onProgress: (i, total) => setStatus('working', `正在提取音频 ${i}/${total} 段…`)
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e; // 取消要向上传播，而非当作“无音轨”
    audio = null;
  }
  if (!audio || !audio.segments.length) {
    toast(audio?.silent ? '音频近乎静音，跳过转写' : '未检测到可用音轨，跳过转写');
    return '';
  }

  // 多段并发转写（限并发，加速长视频）；单段失败不影响其余段，顺序由后续 sort 保证
  const total = audio.segments.length;
  let done = 0;
  let failed = 0;
  const perSeg = await mapLimit(audio.segments, Math.min(3, total), async (seg) => {
    try {
      const r = await transcribeAudio({
        engine: engineKey,
        model: engineConf.defaultModel,
        apiKey: key,
        baseUrl: engineKey === 'openai' ? els.baseUrl.value.trim() : '',
        blob: seg.blob,
        signal
      });
      done++;
      setStatus('working', `正在转写音频 ${done}/${total} 段…`);
      return (r.segments || []).map((s) => ({
        start: (s.start || 0) + seg.offset,
        end: (s.end || 0) + seg.offset,
        text: s.text
      }));
    } catch (e) {
      if (signal?.aborted || e?.name === 'AbortError') throw e; // 取消：中止整个转写
      done++;
      failed++;
      setStatus('working', `正在转写音频 ${done}/${total} 段（有 ${failed} 段失败，已跳过）…`);
      return [];
    }
  });
  // 全部失败：抛出清晰错误（首段错误信息），便于排查（如 Key 无效）
  if (failed === total) {
    throw new Error('音频转写全部失败，请检查转写 API Key 与网络');
  }
  if (failed > 0) toast(`有 ${failed}/${total} 段音频转写失败，已跳过`);
  const merged = perSeg.flat();
  if (!merged.length) {
    toast('音频转写为空（可能无人声/纯音乐）');
    return '';
  }
  merged.sort((a, b) => a.start - b.start); // 防止引擎返回乱序分段
  return formatTranscript(merged);
}

function showResult(result) {
  viewGen++;
  resultMatchesPreview = true; // 刚分析的就是当前 #preview 视频
  els.empty.hidden = true;
  els.resultBody.hidden = false;
  els.exportBar.hidden = false;
  renderResult(result, els.resultBody);
  fillThumbnails(result, viewGen); // 异步填充，不阻塞结果展示
}

// 从历史载入：不抽缩略图（原视频可能已不在），提示需重新上传以联动
function showResultFromHistory(result) {
  resultMatchesPreview = false; // 历史结果与当前 #preview 视频未必一致，禁止跳转
  els.empty.hidden = true;
  els.resultBody.hidden = false;
  els.exportBar.hidden = false;
  renderResult(result, els.resultBody);
  toast('已载入历史结果（缩略图与跳转需重新上传同一视频）');
}

// 按镜头起始时间抽取缩略图，渐进填进分镜表与画廊。gen 用于作废过期填充。
async function fillThumbnails(result, gen) {
  currentThumbs = [];
  const fileAtStart = currentFile;
  if (!fileAtStart || !Array.isArray(result.shots) || !result.shots.length) return;
  const times = computeShotTimes(result.shots, result.meta?.duration);
  const stale = () => gen !== viewGen || currentFile !== fileAtStart;

  setThumbsLoading(true); // 抽帧期间显示加载脉冲
  try {
    currentThumbs = await captureThumbnails(fileAtStart, times, {
      maxDim: 200,
      signal: abortController?.signal,
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
  if (!resultMatchesPreview) { toast('该结果来自历史，请重新上传同一视频后再跳转'); return; }
  els.preview.currentTime = t;
  els.preview.play?.().catch(() => {});
  els.resultBody.querySelectorAll('.shot-row.active, .shot-card.active').forEach((r) => r.classList.remove('active'));
  row.classList.add('active');
  els.preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onResultClick(e) {
  const copyBtn = e.target.closest('[data-action="copy-recreate"]');
  if (copyBtn) {
    if (lastResult) {
      navigator.clipboard.writeText(buildReplicationPrompt(lastResult))
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
  if (!lastResult || !Array.isArray(lastResult.shots)) return;
  const search = els.resultBody.querySelector('#shotSearch');
  const kw = (search?.value || '').trim().toLowerCase();
  const activeSizes = [...els.resultBody.querySelectorAll('.szchip.active')].map((b) => b.dataset.size);
  let visible = 0;
  lastResult.shots.forEach((s, i) => {
    const hay = `${s.shot_number} ${s.shot_size} ${s.movement} ${s.visual} ${s.on_screen_text} ${s.audio}`.toLowerCase();
    const show = (!kw || hay.includes(kw)) && (!activeSizes.length || activeSizes.includes(s.shot_size));
    if (show) visible++;
    const row = els.resultBody.querySelector(`.shot-row[data-row="${i}"]`);
    const card = els.resultBody.querySelector(`.shot-card[data-card="${i}"]`);
    if (row) row.style.display = show ? '' : 'none';
    if (card) card.style.display = show ? '' : 'none';
  });
  const label = els.resultBody.querySelector('#shotCount');
  if (label) {
    label.textContent = visible === lastResult.shots.length
      ? `共 ${visible} 个镜头`
      : `筛选出 ${visible} / ${lastResult.shots.length} 个镜头`;
  }
}

// 就地编辑分镜文字 → 同步回 lastResult（导出随之更新）
function onResultEdit(e) {
  const cell = e.target.closest('[data-field]');
  if (!cell || !lastResult || !Array.isArray(lastResult.shots)) return;
  const i = Number(cell.dataset.i);
  const field = cell.dataset.field;
  if (lastResult.shots[i] && field) {
    lastResult.shots[i][field] = cell.textContent.trim();
  }
}

/* ── 导出 ── */
function handleExport(kind) {
  if (!lastResult) return;
  const name = `${baseName(lastExportMeta?.filename)}_拉片_${nowStamp()}`;
  if (kind === 'md') {
    navigator.clipboard.writeText(toMarkdown(lastResult, lastExportMeta))
      .then(() => toast('Markdown 已复制到剪贴板'))
      .catch(() => toast('复制失败，请改用下载'));
  } else if (kind === 'md-file') {
    download(`${name}.md`, toMarkdown(lastResult, lastExportMeta), 'text/markdown;charset=utf-8');
  } else if (kind === 'csv') {
    download(`${name}.csv`, toCSV(lastResult), 'text/csv;charset=utf-8');
  } else if (kind === 'json') {
    download(`${name}.json`, toJSON(lastResult), 'application/json;charset=utf-8');
  } else if (kind === 'srt') {
    const srt = toSRT(lastResult);
    if (!srt) { toast('无可导出的字幕'); return; }
    download(`${name}.srt`, srt, 'application/x-subrip;charset=utf-8');
  }
}

/* ── 历史记录 ── */
function renderHistory() {
  if (!els.historyBox) return;
  const list = listHistory();
  if (!list.length) { els.historyBox.hidden = true; els.historyBox.innerHTML = ''; return; }
  els.historyBox.hidden = false;
  const items = list.map((e) => `
    <li class="hist-item" data-id="${e.id}">
      <button class="hist-open" data-id="${e.id}" title="载入此结果" aria-label="载入历史结果：${escAttr(e.filename)}">
        <span class="hist-name">${escAttr(e.filename)}</span>
        <span class="hist-sub">${escAttr(e.engine)} · ${e.shotCount} 镜 · ${fmtDate(e.ts)}</span>
      </button>
      <button class="hist-del" data-del="${e.id}" title="删除" aria-label="删除历史：${escAttr(e.filename)}">✕</button>
    </li>`).join('');
  els.historyBox.innerHTML = `<details open><summary>📁 历史分析（最近 ${list.length} 条 · 本机保存）</summary><ul class="hist-list">${items}</ul></details>`;
}

function onHistoryClick(e) {
  const del = e.target.closest('[data-del]');
  if (del) { deleteResult(del.dataset.del); renderHistory(); return; }
  const open = e.target.closest('.hist-open');
  if (open) {
    const result = loadResult(open.dataset.id);
    if (!result || typeof result !== 'object' || !Array.isArray(result.shots)) {
      toast('历史数据已损坏，无法载入');
      deleteResult(open.dataset.id);
      renderHistory();
      return;
    }
    const entry = listHistory().find((x) => x.id === open.dataset.id);
    lastResult = result;
    lastExportMeta = { filename: entry?.filename || '历史结果', engine: entry?.engine || '' };
    viewGen++;            // 作废任何在途缩略图
    currentThumbs = [];
    showResultFromHistory(result);
    setStatus('done', `已载入历史结果 · ${result.shots?.length || 0} 个镜头`);
  }
}

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ''; }
}

/* ── 状态/工具 ── */
function setStatus(type, msg) {
  if (!type) { els.status.hidden = true; return; }
  els.status.hidden = false;
  els.status.className = 'status ' + type;
  els.status.innerHTML = (type === 'working' ? '<span class="spinner"></span>' : '') +
    `<span>${escAttr(msg)}</span>`;
}

function setBusy(b) {
  busy = b;
  // 分析中按钮保持可点击，作为「取消」入口
  els.analyzeBtn.disabled = b ? false : !currentFile;
  els.analyzeBtn.textContent = b ? '取消分析' : '开始拉片分析';
  els.analyzeBtn.classList.toggle('is-cancel', b);
}

/* ── 事件绑定 ── */
function bind() {
  els.provider.addEventListener('change', () => { applyProvider(); persist(); });
  els.model.addEventListener('input', persist);
  els.apiKey.addEventListener('input', persist);
  els.baseUrl.addEventListener('input', persist);
  els.focus.addEventListener('input', persist);
  els.maxFrames.addEventListener('input', () => {
    els.maxFramesVal.textContent = els.maxFrames.value;
    persist();
  });
  els.transcribeOn.addEventListener('change', () => { applyTranscribe(); persist(); });
  els.transcribeEngine.addEventListener('change', persist);
  els.transcribeKey.addEventListener('input', persist);

  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('dragover'); })
  );
  els.dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  els.analyzeBtn.addEventListener('click', () => {
    if (busy) { abortController?.abort(); } // 分析中点击=取消
    else runAnalysis();
  });
  els.exportBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-export]');
    if (btn) handleExport(btn.dataset.export);
  });
  if (els.historyBox) els.historyBox.addEventListener('click', onHistoryClick);
  els.resultBody.addEventListener('click', onResultClick);
  els.resultBody.addEventListener('input', (e) => {
    if (e.target.id === 'shotSearch') { applyFilter(); return; }
    onResultEdit(e);
  });
  els.resultBody.addEventListener('keydown', (e) => {
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
  });
}

initUI();
bind();
