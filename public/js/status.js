// 状态栏与忙碌态（分析按钮兼作取消入口）。
import { escAttr } from './util.js';
import { els, state } from './ui-state.js';

export function setStatus(type, msg) {
  if (!type) { els.status.hidden = true; return; }
  els.status.hidden = false;
  els.status.className = 'status ' + type;
  els.status.innerHTML = (type === 'working' ? '<span class="spinner"></span>' : '') +
    `<span>${escAttr(msg)}</span>`;
}

export function setBusy(b) {
  state.busy = b;
  // 分析中按钮保持可点击，作为「取消」入口
  els.analyzeBtn.disabled = b ? false : !state.currentFile;
  els.analyzeBtn.textContent = b ? '取消分析' : '开始拉片分析';
  els.analyzeBtn.classList.toggle('is-cancel', b);
}
