// 把配置保存在浏览器 localStorage（API Key 按 provider 分别保存）。

const KEY = 'framecut.settings.v1';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    mode: 'video',
    hint: '原生上传整段视频，可同时分析画面与音频，时间轴最准，最适合拉片。',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    needsBaseUrl: false
  },
  claude: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-4-6',
    mode: 'frames',
    hint: '浏览器抽取关键帧后做视觉分析；音频由画面线索推断。',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsBaseUrl: false
  },
  openai: {
    label: 'OpenAI GPT',
    defaultModel: 'gpt-4o',
    mode: 'frames',
    hint: '浏览器抽取关键帧后做视觉分析；音频由画面线索推断。支持自定义网关。',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsBaseUrl: true
  }
};

export const TRANSCRIBE_ENGINES = {
  openai: { label: 'OpenAI Whisper', defaultModel: 'whisper-1', provider: 'openai' },
  gemini: { label: 'Gemini', defaultModel: 'gemini-2.5-flash', provider: 'gemini' }
};

const defaults = {
  provider: 'gemini',
  models: {},      // { gemini: '...', claude: '...', openai: '...' }
  keys: {},        // { gemini: '...', ... }
  baseUrl: '',
  focus: '',
  maxFrames: 48,
  transcribeOn: false,
  transcribeEngine: 'openai',
  transcribeKey: ''   // 留空则在同源时复用分析引擎的 key
};

export function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function save(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 忽略隐私模式等存储失败 */
  }
}
