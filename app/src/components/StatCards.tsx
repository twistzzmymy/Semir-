import type { ModelshotResult } from "../lib/types";

interface StatCardsProps {
  results: ModelshotResult[];
}

export function StatCards({ results }: StatCardsProps) {
  const total = results.length;
  const passed = results.filter((item) => item.status === "passed").length;
  const warning = results.filter((item) => item.status === "warning").length;
  const pending = results.filter((item) => item.status === "pending").length;

  return (
    <section className="stats-grid">
      <div className="stat-card">
        <span>总任务数</span>
        <strong>{total}</strong>
      </div>

      <div className="stat-card">
        <span>模拍通过</span>
        <strong>{passed}</strong>
      </div>

      <div className="stat-card">
        <span>需要关注</span>
        <strong>{warning}</strong>
      </div>

      <div className="stat-card">
        <span>待人工确认</span>
        <strong>{pending}</strong>
      </div>
    </section>
  );
}