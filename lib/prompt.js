// 构建「专业视频分析专家 / 拉片」分析所需的提示词。
// mode: 'video'（Gemini 原生整段视频，含音频）| 'frames'（抽帧序列，音频靠画面推断）

const OUTPUT_SHAPE = `请只输出一个 JSON 对象（不要任何额外解释、不要 Markdown 代码块），结构如下：
{
  "video_summary": "一句话概括视频的主题、类型与目的",
  "style": {
    "overall": "整体风格定位（如：电影感叙事 / 干净商业产品片 / Vlog 生活流 / 赛博朋克 等）",
    "color_grading": "色调与调色（主色、对比、饱和度、是否有 LUT 风格、冷暖倾向）",
    "lighting": "光线与布光（自然光/人工光、硬光/柔光、方向、明暗反差、时间氛围）",
    "composition": "构图特点（画幅比例、对称/三分、前后景、负空间、主体位置）",
    "camera_language": "镜头语言与运镜倾向（景别使用习惯、运动方式、节奏感）",
    "editing": "剪辑节奏与转场（平均镜头时长、硬切/叠化/匹配剪辑、节奏快慢）",
    "mood": "氛围与情绪基调",
    "audio_design": "音频设计（配乐风格、音效、旁白/对白、节拍与画面的关系）",
    "pacing": "整体节奏描述",
    "replication_tips": "复刻要点：给出可执行的拍摄与后期建议（设备/镜头焦段、拍摄手法、灯光、调色方向、剪辑节奏、配乐方向等），让他人能精准复刻同款视频"
  },
  "shots": [
    {
      "shot_number": 1,
      "start": "0:00",
      "end": "0:03",
      "duration_sec": 3.0,
      "shot_size": "景别 / 角度（如：中景 / 平视、特写 / 仰拍、全景 / 俯拍）",
      "movement": "镜头运动（固定 / 推 / 拉 / 摇 / 移 / 跟 / 升降 / 手持 / 环绕 / 变焦 等）",
      "visual": "画面内容：主体、动作、环境、道具、服化道、画面中的文字/字幕、视觉重点",
      "audio": "音频：对白/旁白内容要点、配乐风格、音效、环境声、是否静音"
    }
  ]
}`;

const ROLE = `你是一名顶尖的影视/广告/短视频「拉片」分析专家，精通分镜、摄影、灯光、剪辑、调色与声音设计。
你的任务：对给定视频做**逐镜头的深度拉片分析**，输出可用于精准复刻的分镜镜头脚本，并总结画面风格。`;

const RULES = `分析要求：
1. 以「镜头/分镜」为单位切分：每当发生镜头切换（硬切、转场、明显的机位/景别/被摄主体变化）就视为一个新镜头，依次编号。
2. 景别用专业术语：远景/大远景、全景、中景、近景、特写、大特写；角度标注：平视/俯拍/仰拍/过肩/主观视角(POV)/航拍 等。
3. 运动准确描述运镜方式与幅度，固定镜头也要写「固定」。
4. 画面内容要具体到可复刻：主体是谁/什么、在做什么、所处环境、关键道具与服化、画面里的文字或字幕、构图与视觉重点。
5. 音频要尽量还原：有对白/旁白则概括其内容要点，标注配乐情绪与风格、关键音效、环境声、节拍卡点。
6. 时长尽量精确到秒（可保留一位小数），start/end 用 m:ss 或 mm:ss 形式，duration_sec 为数字。
7. 所有文字用**简体中文**。务必覆盖整段视频，不要遗漏镜头，也不要凭空编造没有依据的内容。`;

export function buildAnalysisPrompt({ mode, meta = {}, focus = '' }) {
  const durationLine = meta.duration
    ? `视频总时长约 ${formatDuration(meta.duration)}（${Math.round(meta.duration)} 秒）。`
    : '';
  const resLine = meta.width && meta.height ? `分辨率约 ${meta.width}x${meta.height}。` : '';
  const fileLine = meta.filename ? `文件名：${meta.filename}。` : '';

  let modeNote = '';
  if (mode === 'frames') {
    modeNote = `输入形式：由于按时间顺序对视频抽取了若干关键帧（每张图片附带其在视频中的时间戳），请把这些帧理解为连续视频的采样。
请基于帧的内容与时间戳推断镜头切分与时长；音频无法直接听到，请结合画面中的字幕、口型、场景与上下文合理推断「音频」一列（并可注明系推断）。`;
  } else {
    modeNote = `输入形式：完整视频（包含画面与声音）。请同时听取音频，准确还原对白/旁白、配乐与音效。`;
  }

  const focusNote = focus && focus.trim() ? `\n用户额外关注点：${focus.trim()}\n` : '';

  return `${ROLE}

${[durationLine, resLine, fileLine].filter(Boolean).join(' ')}
${modeNote}
${focusNote}
${RULES}

${OUTPUT_SHAPE}`;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
