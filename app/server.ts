import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API 路由：图片分析
  app.post("/api/analyze", async (req, res) => {
    try {
      const { imageSource } = req.body;
      const apiKey = process.env.QWEN_API_KEY || "Nvexxxqke1rj7ZFp"; // 优先使用环境变量
      const apiUrl = process.env.QWEN_API_URL || "https://ai-aigw.semir.com/bailian-tongyi-outside/v1";

      // 准备消息。千问视觉模型通常兼容 OpenAI 格式。
      const messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请分析这张图片。判断逻辑：如果图片中出现了人体的一部分（全身、躯干、肢体、手或脚）用来展示商品，则属于‘模拍主图’。请以 JSON 格式返回结果，包含布尔值字段 isMainProductShot 和 confidence（0-1 之间）。"
            },
            {
              type: "image_url",
              image_url: {
                url: imageSource.startsWith('http') ? imageSource : `data:image/jpeg;base64,${imageSource}`
              }
            }
          ]
        }
      ];

      const response = await axios.post(
        `${apiUrl}/chat/completions`,
        {
          model: "qwen-vl-max", // 常用视觉模型名称
          messages,
          response_format: { type: "json_object" }
        },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      const content = response.data.choices[0].message.content;
      let result;
      try {
        result = typeof content === 'string' ? JSON.parse(content) : content;
      } catch (e) {
        // 如果模型没有返回纯 JSON，尝试正则提取
        const match = content.match(/\{.*\}/s);
        result = match ? JSON.parse(match[0]) : { isMainProductShot: false, confidence: 0 };
      }

      res.json({
        hasModel: result.isMainProductShot, // 简化版，同 isMainProductShot
        isMainProductShot: result.isMainProductShot,
        confidence: result.confidence || 0.9
      });

    } catch (error: any) {
      console.error("AI Analysis Error:", error.response?.data || error.message);
      res.status(500).json({ error: "AI 分析请求失败", details: error.message });
    }
  });

  // Vite 中间件配置
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
