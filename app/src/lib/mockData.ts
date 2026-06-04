import type { ModelshotResult } from "./types";

export const mockResults: ModelshotResult[] = [
  {
    id: "SM20260604001",
    productLine: "女装",
    imageOneToOne: "https://example.com/1x1.jpg",
    imageThreeToFour: "https://example.com/3x4.jpg",
    isModelshot: true,
    confidence: 0.92,
    reason: "1:1 与 3:4 主图均判断为模拍图，人物主体清晰。",
    status: "passed",
  },
  {
    id: "SM20260604002",
    productLine: "男装",
    imageOneToOne: "https://example.com/a.jpg",
    imageThreeToFour: "https://example.com/b.jpg",
    isModelshot: false,
    confidence: 0.71,
    reason: "主图更接近平铺或静物图，未检测到明显真人模特。",
    status: "warning",
  },
  {
    id: "SM20260604003",
    productLine: "童装",
    imageOneToOne: "https://example.com/c.jpg",
    imageThreeToFour: "https://example.com/d.jpg",
    isModelshot: null,
    confidence: null,
    reason: "图片链接暂未识别，请人工复核。",
    status: "pending",
  },
];