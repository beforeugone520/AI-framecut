// 配置面板的初始化、provider/转写联动、设置持久化。
import { els, settings } from './ui-state.js';
import { save, PROVIDERS } from './store.js';
import { renderHistory } from './history-ui.js';

export function initUI() {
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

export function applyProvider() {
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

export function applyTranscribe() {
  els.transcribeOpts.hidden = !els.transcribeOn.checked;
}

export function persist() {
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
