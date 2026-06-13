// 历史记录的界面：列表渲染、载入/删除交互。（存储逻辑在 history.js）
import { toast, escAttr } from './util.js';
import { els, state } from './ui-state.js';
import { listHistory, loadResult, deleteResult } from './history.js';
import { setStatus } from './status.js';
import { showResultFromHistory } from './results.js';
import { fmtDate } from './logic.js';

export function renderHistory() {
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

export function onHistoryClick(e) {
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
    state.lastResult = result;
    state.lastExportMeta = { filename: entry?.filename || '历史结果', engine: entry?.engine || '' };
    state.viewGen++;            // 作废任何在途缩略图
    state.currentThumbs = [];
    showResultFromHistory(result);
    setStatus('done', `已载入历史结果 · ${result.shots?.length || 0} 个镜头`);
  }
}
