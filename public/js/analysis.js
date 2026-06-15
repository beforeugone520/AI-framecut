// 分析主流程：Gemini 原生 / 抽帧 + 音频转写编排。
import { toast, friendlyError, mapLimit } from './util.js';
import { PROVIDERS, TRANSCRIBE_ENGINES } from './store.js';
import { els, state, settings } from './ui-state.js';
import { setStatus, setBusy } from './status.js';
import { persist } from './settings-ui.js';
import { extractFrames } from './extract.js';
import { extractAudioSegments, formatTranscript } from './audio.js';
import { analyzeVideo, analyzeFrames, transcribeAudio } from './api.js';
import { showResult } from './results.js';
import { saveResult } from './history.js';
import { renderHistory } from './history-ui.js';
import { resolveTranscribeKey } from './logic.js';

export async function runAnalysis() {
  if (state.busy || !state.currentFile) return;
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

  if (state.abortController) state.abortController.abort(); // 作废上一次（理论上不会重叠，防御）
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  setBusy(true);
  try {
    let result;
    if (conf.mode === 'video') {
      setStatus('working', '正在上传视频并调用 Gemini 分析（视频较大时可能需要 1～3 分钟）…');
      result = await analyzeVideo({ file: state.currentFile, model, apiKey, baseUrl: els.baseUrl.value.trim(), focus, meta: state.currentMeta, signal });
    } else {
      setStatus('working', '正在抽取关键帧…');
      const frames = await extractFrames(state.currentFile, {
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
        apiMode: provider === 'openai' ? els.openaiMode.value : '',
        frames, focus, transcript, signal,
        meta: { ...state.currentMeta, filename: state.currentFile.name }
      });
      if (transcript) result.transcript = transcript;
    }

    if (!result || !Array.isArray(result.shots) || result.shots.length === 0) {
      throw new Error('模型未返回有效的分镜数据，请重试或更换模型');
    }

    state.lastResult = result;
    state.lastExportMeta = { filename: state.currentFile.name, engine: `${conf.label} · ${model}` };
    showResult(result);
    try {
      const { saved } = saveResult(result, state.lastExportMeta);
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

  const key = resolveTranscribeKey({
    explicitKey: els.transcribeKey.value,
    engineProvider: engineConf.provider,
    analysisProvider,
    analysisKey,
    storedKey: settings.keys[engineConf.provider]
  });
  if (!key) {
    throw new Error(`音频转写需要 ${engineConf.label} 的 API Key（在「高级设置」里填写，或留空以复用同源分析 Key）`);
  }

  setStatus('working', '正在提取音频…');
  let audio = null;
  try {
    audio = await extractAudioSegments(state.currentFile, {
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
        baseUrl: engineConf.provider === analysisProvider ? els.baseUrl.value.trim() : '',
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
  // 全部失败：抛出清晰错误，便于排查（如 Key 无效）
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
