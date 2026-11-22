 import { PaperAnalysisResponse, GameSettings } from "../types";

// 🔴 在下面双引号里填入你刚申请的 OpenRouter API Key（以 sk-or-v1- 开头）
const OPENROUTER_API_KEY = "把你的sk-or-v1密钥粘贴在这里";

// 自动按顺序尝试 OpenRouter 上的免费大模型，防止单个免费模型拥挤
const FREE_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free"
];

// 将上传的文件转换为 Base64 或纯文本
const readFileData = async (file: File): Promise<{ isPdf: boolean; content: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      reader.onloadend = () => {
        resolve({ isPdf: true, content: reader.result as string });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else {
      reader.onloadend = () => {
        resolve({ isPdf: false, content: reader.result as string });
      };
      reader.onerror = reject;
      reader.readAsText(file);
    }
  });
};

export const analyzePaper = async (file: File, settings: GameSettings): Promise<PaperAnalysisResponse> => {
  const fileData = await readFileData(file);

  const detailInstruction = settings.detailLevel === 'detailed'
    ? "讲解要极其细致，对话回合数至少要25轮以上。不要略过任何技术细节，尤其是方法论和实验部分。"
    : (settings.detailLevel === 'academic'
        ? "讲解要专业且有深度，使用专业术语但随后进行解释，重点分析论文的创新点和不足，对话长度30轮左右。"
        : "讲解要简明扼要，重点突出，适合快速阅读，15轮左右。");

  const personalityInstruction = settings.personality === 'tsundere'
    ? "语气要非常傲娇。虽然很嫌弃主殿（用户）看不懂，但还是很用心地解释。多用“真拿你没办法”、“笨蛋主殿”等词汇。"
    : (settings.personality === 'gentle'
        ? "语气要非常温柔，像大姐姐一样。多鼓励主殿，“没关系，慢慢来”、“主殿真棒”。"
        : "语气要严厉，像魔鬼教官。要求主殿必须跟上思路，不许偷懒。");

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
    你必须只输出纯合法的 JSON 字符串，绝对不要包含 \`\`\`json 或 \`\`\` 等 Markdown 标记，也不要输出任何多余解释文字。
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
  `;

  const userContent: any[] = [{ type: "text", text: prompt }];

  if (fileData.isPdf) {
    userContent.push({
      type: "file",
      file: {
        filename: file.name || "paper.pdf",
        file_data: fileData.content
      }
    });
  } else {
    userContent.push({
      type: "text",
      text: `\n\n以下是论文正文内容：\n${fileData.content.slice(0, 60000)}`
    });
  }

  for (const model of FREE_MODELS) {
    try {
      const response = await fetch("https://openrouter.ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY.trim()}`,
          "HTTP-Referer": window.location.origin,
          "X-Title": "Paper2Galgame"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: userContent }],
          temperature: 0.7
        })
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      let rawText: string = data.choices?.[0]?.message?.content || "";
      if (!rawText) continue;

      // 清理模型可能自带的 markdown 代码块符号
      rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

      const parsed = JSON.parse(rawText) as PaperAnalysisResponse;
      if (parsed && Array.isArray(parsed.script) && parsed.script.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn(`Model ${model} failed, trying next...`, err);
    }
  }

  return {
    title: "灵力回路遮断",
    script: [
      {
        speaker: "丛雨",
        text: "呜... 主殿，连结彼岸的通道似乎被干扰了（API Request Failed）。",
        emotion: "shy"
      },
      {
        speaker: "丛雨",
        text: "请检查 OpenRouter 的 API Key 是否正确填写，或者稍后再试一次のじゃ！",
        emotion: "angry"
      }
    ]
  };
};
