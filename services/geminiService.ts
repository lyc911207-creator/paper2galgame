import * as pdfjsLib from "pdfjs-dist";
import { PaperAnalysisResponse, GameSettings } from "../types";

// 設定 PDF.js 的 Worker（使用 CDN 避免打包配置問題）
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com{pdfjsLib.version}/build/pdf.worker.min.mjs`;

// 建議改用環境變數讀取，例如 import.meta.env.VITE_OPENROUTER_API_KEY
const OPENROUTER_API_KEY = "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";

const MODELS_TO_TRY = [
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openrouter/free"
];

/**
 * 統一將 PDF 或純文字檔案提取為字串，確保所有模型都能穩定讀取
 */
const extractTextFromFile = async (file: File): Promise<string> => {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    return await file.text();
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += `\n--- Page ${pageNum} ---\n${pageText}`;
  }

  return fullText;
};

/**
 * 從模型回覆中安全提取並解析 JSON（防止模型在前後加上多餘文字導致解析失敗）
 */
const parseSafeJson = (rawText: string): PaperAnalysisResponse => {
  // 1. 移除 Markdown 標記
  let cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // 2. 截取第一個 '{' 到最後一個 '}' 之間的內容
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned) as PaperAnalysisResponse;
};

export const analyzePaper = async (
  file: File,
  settings: GameSettings
): Promise<PaperAnalysisResponse> => {
  let paperText = "";
  try {
    paperText = await extractTextFromFile(file);
    if (!paperText.trim()) {
      throw new Error("未能從文件中提取到任何有效文字（可能是純圖片掃描版 PDF）。");
    }
  } catch (err: any) {
    return {
      title: "卷轴解析失败",
      script: [
        {
          speaker: "丛雨",
          text: `呜... 吾辈打不开这本卷轴のじゃ！（原因：${err?.message || "文件读取失败"}）`,
          emotion: "shy"
        }
      ]
    };
  }

  const detailInstruction =
    settings.detailLevel === "detailed"
      ? "讲解要极其细致，对话回合数至少要25轮以上。不要略过任何技术细节，尤其是方法论和实验部分。"
      : settings.detailLevel === "academic"
      ? "讲解要专业且有深度，使用专业术语但随后进行解释，重点分析论文的创新点和不足，对话长度30轮左右。"
      : "讲解要简明扼要，重点突出，适合快速阅读，15轮左右。";

  const personalityInstruction =
    settings.personality === "tsundere"
      ? "语气要非常傲娇。虽然很嫌弃主殿（用户）看不懂，但还是很用心地解释。多用“真拿你没办法”、“笨蛋主殿”等词汇。"
      : settings.personality === "gentle"
      ? "语气要非常温柔，像大姐姐一样。多鼓励主殿，“没关系，慢慢来”、“主殿真棒”。"
      : "语气要严厉，像魔鬼教官。要求主殿必须跟上思路，不许偷懒。";

  const prompt = `
你现在是Visual Novel游戏中的角色“丛雨”（Murasame）。

人物设定：
1. 身份：寄宿在神刀“丛雨丸”中的守护灵，活了五百年的幼女姿态。
2. 称呼：自称“吾辈”（Wagahai），称呼用户为“主殿”（Aruji-dono）。
3. 核心性格：古风，博学，${personalityInstruction}
4. 口癖：句尾常带“...のじゃ”(noja), “...おる”(oru), “...なのだ”(nanoda), “...である”(dearu)。

任务：阅读这篇论文，并以Visual Novel对话的形式向“主殿”详细讲解。

${detailInstruction}

请严格按以下结构进行讲解（不要在对话中直接说是“第一部分”，要自然地流露）：
1. **开场 (Intro)**：评价标题，或者针对论文的长度/难度发发牢骚。
2. **背景与痛点 (Background)**：这篇论文究竟是解决什么问题的？为什么以前的方法不行？（此处需要跟主殿互动，确认他听懂了）。
3. **核心方法 (Methodology)**：这是最重要的地方。详细拆解它的模型架构、算法公式（用比喻解释）、创新模块。必须分点讲清楚。
4. **实验结果 (Experiments)**：在什么数据集上做的？SOTA对比如何？有没有什么消融实验值得注意？
5. **总结与八卦 (Conclusion)**：这论文有没有灌水的嫌疑？或者真的很有跨时代意义？

【极其重要的输出格式要求】：
你必须只输出纯合法的 JSON 字符串，绝对不要包含 markdown 代码块标记，也不要输出任何多余解释文字。
JSON 必须严格符合以下结构：
{
  "title": "论文标题或趣味总结",
  "script": [
    {
      "speaker": "丛雨",
      "text": "对话内容",
      "emotion": "normal",
      "note": "可选的专业术语解释，没有则填 null"
    }
  ]
}
其中 emotion 只能从以下 6 个词中选一个："normal", "happy", "angry", "surprised", "shy", "proud"。

以下是论文正文内容：
${paperText.slice(0, 60000)}
  `.trim();

  let lastErrorMsg = "未知错误";

  for (const model of MODELS_TO_TRY) {
    try {
      const response = await fetch("https://openrouter.ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY.trim()}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "Paper2Galgame"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        lastErrorMsg = `[${model}] HTTP ${response.status}: ${errText.slice(0, 120)}`;
        continue;
      }

      const data = await response.json();
      const rawText: string = data?.choices?.[0]?.message?.content || "";

      if (!rawText) {
        lastErrorMsg = `[${model}] 模型返回内容为空`;
        continue;
      }

      const parsed = parseSafeJson(rawText);

      if (parsed && Array.isArray(parsed.script) && parsed.script.length > 0) {
        return parsed;
      } else {
        lastErrorMsg = `[${model}] JSON 结构缺少有效的 script 数组`;
      }
    } catch (err: any) {
      lastErrorMsg = `[${model}] ${err?.message || String(err)}`;
    }
  }

  return {
    title: "灵力回路遮断",
    script: [
      {
        speaker: "丛雨",
        text: `呜... 主殿，所有备用通道都被干扰了（最后错误：${lastErrorMsg}）。`,
        emotion: "shy"
      },
      {
        speaker: "丛雨",
        text: "请主殿检查一下 API Key 额度，或者稍后再试一次のじゃ！",
        emotion: "angry"
      }
    ]
  };
};
