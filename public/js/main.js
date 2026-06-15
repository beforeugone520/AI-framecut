// 入口：装配各模块、处理文件上传、绑定事件、初始化。
import { escAttr, fmtTime, fmtBytes } from './util.js';
import { els, state } from './ui-state.js';
import { loadVideoMeta } from './extract.js';
import { setStatus } from './status.js';
import { initUI, applyProvider, applyTranscribe, persist } from './settings-ui.js';
import { runAnalysis } from './analysis.js';
import { onResultClick, onResultInput, onResultKeydown, handleExport } from './results.js';
import { renderHistory, onHistoryClick } from './history-ui.js';

/* ── 文件处理 ── */
async function handleFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    setStatus('error', '请选择视频文件');
    return;
  }
  try {
    if (state.currentObjectUrl) URL.revokeObjectURL(state.currentObjectUrl);
    const meta = await loadVideoMeta(file);
    state.currentFile = file;
    state.currentMeta = { duration: meta.duration, width: meta.width, height: meta.height };
    state.currentObjectUrl = meta.objectUrl;

    // 换视频：取消任何在途分析/缩略图，作废旧结果，避免旧分镜行点击后跳错视频、旧缩略图错填
    if (state.abortController) state.abortController.abort();
    state.viewGen++;
    state.lastResult = null;
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

/* ── 事件绑定 ── */
function bind() {
  els.provider.addEventListener('change', () => { applyProvider(); persist(); });
  els.model.addEventListener('input', persist);
  els.apiKey.addEventListener('input', persist);
  els.baseUrl.addEventListener('input', persist);
  els.openaiMode.addEventListener('change', persist);
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
    if (state.busy) { state.abortController?.abort(); } // 分析中点击=取消
    else runAnalysis();
  });
  els.exportBar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-export]');
    if (btn) handleExport(btn.dataset.export);
  });
  if (els.historyBox) els.historyBox.addEventListener('click', onHistoryClick);
  els.resultBody.addEventListener('click', onResultClick);
  els.resultBody.addEventListener('input', onResultInput);
  els.resultBody.addEventListener('keydown', onResultKeydown);
}

initUI();
bind();
