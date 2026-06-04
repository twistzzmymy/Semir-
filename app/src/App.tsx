import { useState } from "react";
import { Header } from "./components/Header";
import { ResultTable } from "./components/ResultTable";
import { StatCards } from "./components/StatCards";
import { UploadPanel } from "./components/UploadPanel";
import { mockResults } from "./lib/mockData";
import type { ModelshotResult } from "./lib/types";
import "./index.css";

export default function App() {
  const [results, setResults] = useState<ModelshotResult[]>([]);

  return (
    <main className="app-shell">
      <Header />

      <section className="hero-card">
        <div>
          <p className="eyebrow">AI Modelshot Recognition</p>
          <h2>从主图链接到模拍判断，一站式完成质检</h2>
          <p>
            帮助商品运营、视觉审核和 RPA 流程快速识别主图是否符合模拍要求，
            减少人工检查成本，提高上新效率。
          </p>
        </div>

        <div className="hero-actions">
          <a href="#upload" className="primary-link">
            开始识别
          </a>
          <a href="#results" className="ghost-link">
            查看结果
          </a>
        </div>
      </section>

      <StatCards results={results} />

      <div id="upload">
        <UploadPanel
          onUseDemo={() => setResults(mockResults)}
          onClear={() => setResults([])}
        />
      </div>

      <div id="results">
        <ResultTable results={results} />
      </div>
    </main>
  );
}