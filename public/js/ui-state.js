// 共享状态中枢：DOM 元素引用、持久化设置、运行时可变状态。
// 各 UI 模块都从这里读写，避免把状态散落或层层传参。
import { $ } from './util.js';
import { load } from './store.js';

export const els = {
  provider: $('#provider'),
  providerHint: $('#providerHint'),
  model: $('#model'),
  apiKey: $('#apiKey'),
  baseUrlField: $('#baseUrlField'),
  baseUrl: $('#baseUrl'),
  openaiModeField: $('#openaiModeField'),
  openaiMode: $('#openaiMode'),
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

// 持久化设置（对象，跨模块共享同一引用，persist 内就地修改后 save）
export const settings = load();

// 运行时可变状态
export const state = {
  currentFile: null,
  currentMeta: null,         // { duration, width, height }
  currentObjectUrl: null,
  lastResult: null,
  lastExportMeta: null,
  busy: false,
  viewGen: 0,                // 视图代号：换视频/重新分析时自增，作废在途缩略图填充
  currentThumbs: [],         // 缩略图 dataURL 缓存
  resultMatchesPreview: false, // 当前结果是否对应已载入的 #preview 视频
  abortController: null      // 贯穿当前分析的取消控制器
};
