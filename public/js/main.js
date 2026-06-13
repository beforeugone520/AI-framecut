import { $, fmtTime, fmtBytes, download, toast, baseName, mapLimit } from './util.js';
import { load, save, PROVIDERS, TRANSCRIBE_ENGINES } from './store.js';
import { loadVideoMeta, extractFrames } from './extract.js';
import { extractAudioSegments, formatTranscript } from './audio.js';
import { captureThumbnails } from './thumbs.js';
import { analyzeVideo, analyzeFrames, transcribeAudio } from './api.js';
import { renderResult, computeShotTimes } from './render.js';
import { toMarkdown, toCSV, toJSON, buildReplicationPrompt } from './exporters.js';

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
  exportBar: $('#exportBar')
};

const settings = load();
let currentFile = null;
let currentMeta = null;       // { duration, width, height }
let currentObjectUrl = null;
let lastResult = null;
let lastExportMeta = null;
let busy = false;
let viewGen = 0; // 视图代号：换视频/重新分析时自增，作废在途的缩略图填充

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

    // 换视频：作废旧结果，避免旧分镜行点击后跳错视频、旧缩略图错填
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

  setBusy(true);
  try {
    let result;
    if (conf.mode === 'video') {
      setStatus('working', '正在上传视频并调用 Gemini 分析（视频较大时可能需要 1～3 分钟）…');
      result = await analyzeVideo({ file: currentFile, model, apiKey, focus, meta: currentMeta });
    } else {
      setStatus('working', '正在抽取关键帧…');
      const frames = await extractFrames(currentFile, {
        maxFrames: Number(els.maxFrames.value),
        onProgress: (i, total) => setStatus('working', `正在抽取关键帧 ${i}/${total}…`)
      });

      const transcript = els.transcribeOn.checked
        ? await runTranscription(provider, apiKey)
        : '';

      setStatus('working', `已抽取 ${frames.length} 帧${transcript ? '（含真实音频转写）' : ''}，正在调用 ${conf.label} 分析…`);
      result = await analyzeFrames({
        provider, model, apiKey,
        baseUrl: els.baseUrl.value.trim(),
        frames, focus, transcript,
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
    setStatus('done', `分析完成 · 共 ${result.shots.length} 个镜头`);
  } catch (err) {
    console.error(err);
    setStatus('error', err.message || String(err));
  } finally {
    setBusy(false);
  }
}

// 提取音频 → 分段转写 → 按全局偏移合并 → 返回带时间戳的转写文本
async function runTranscription(analysisProvider, analysisKey) {
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
      onProgress: (i, total) => setStatus('working', `正在提取音频 ${i}/${total} 段…`)
    });
  } catch {
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
        blob: seg.blob
      });
      done++;
      setStatus('working', `正在转写音频 ${done}/${total} 段…`);
      return (r.segments || []).map((s) => ({
        start: (s.start || 0) + seg.offset,
        end: (s.end || 0) + seg.offset,
        text: s.text
      }));
    } catch (e) {
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
  els.empty.hidden = true;
  els.resultBody.hidden = false;
  els.exportBar.hidden = false;
  renderResult(result, els.resultBody);
  fillThumbnails(result, viewGen); // 异步填充，不阻塞结果展示
}

// 按镜头起始时间抽取缩略图，填进分镜表第一列。gen 用于作废过期填充。
async function fillThumbnails(result, gen) {
  const fileAtStart = currentFile;
  if (!fileAtStart || !Array.isArray(result.shots) || !result.shots.length) return;
  const times = computeShotTimes(result.shots, result.meta?.duration);
  let thumbs;
  try {
    thumbs = await captureThumbnails(fileAtStart, times, { maxDim: 200 });
  } catch {
    return; // 缩略图失败不影响主结果
  }
  // 期间若换了视频或重新分析，则放弃本次填充，避免错填到新结果
  if (gen !== viewGen || currentFile !== fileAtStart) return;
  thumbs.forEach((url, i) => {
    if (!url) return;
    const el = els.resultBody.querySelector(`.thumb[data-thumb="${i}"]`);
    if (el) {
      el.style.backgroundImage = `url(${url})`;
      el.classList.add('has-img');
    }
  });
}

// 点击镜头 → 视频跳转到该时刻播放并高亮
function seekTo(row) {
  const t = parseFloat(row.dataset.start);
  if (!Number.isFinite(t)) return;
  if (!els.preview.src) { toast('请先上传视频'); return; }
  els.preview.currentTime = t;
  els.preview.play?.().catch(() => {});
  els.resultBody.querySelectorAll('.shot-row.active').forEach((r) => r.classList.remove('active'));
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
  const row = e.target.closest('.shot-row');
  if (row) seekTo(row);
}

/* ── 导出 ── */
function handleExport(kind) {
  if (!lastResult) return;
  const name = baseName(lastExportMeta?.filename) + '_拉片';
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
  }
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
  els.analyzeBtn.disabled = b || !currentFile;
  els.analyzeBtn.textContent = b ? '分析中…' : '开始拉片分析';
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  els.analyzeBtn.addEventListener('click', runAnalysis);
  els.exportBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-export]');
    if (btn) handleExport(btn.dataset.export);
  });
  els.resultBody.addEventListener('click', onResultClick);
  els.resultBody.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('shot-row')) {
      e.preventDefault();
      seekTo(e.target);
    }
  });
}

initUI();
bind();
