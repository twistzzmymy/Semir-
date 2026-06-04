import type { ModelshotResult } from "../lib/types";

interface ResultTableProps {
  results: ModelshotResult[];
}

const statusText = {
  passed: "通过",
  warning: "需关注",
  failed: "异常",
  pending: "待确认",
};

export function ResultTable({ results }: ResultTableProps) {
  if (results.length === 0) {
    return (
      <section className="panel empty-panel">
        <h2>暂无识别结果</h2>
        <p>请先上传文件，或点击“使用示例数据”查看页面效果。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="table-header">
        <div>
          <p className="section-label">Step 02</p>
          <h2>识别结果</h2>
        </div>

        <button className="secondary-button" type="button">
          导出结果
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>主 ID</th>
              <th>产品线</th>
              <th>是否模拍</th>
              <th>置信度</th>
              <th>状态</th>
              <th>判断理由</th>
            </tr>
          </thead>

          <tbody>
            {results.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.productLine}</td>
                <td>
                  {item.isModelshot === null
                    ? "待确认"
                    : item.isModelshot
                      ? "是"
                      : "否"}
                </td>
                <td>
                  {item.confidence === null
                    ? "-"
                    : `${Math.round(item.confidence * 100)}%`}
                </td>
                <td>
                  <span className={`status-pill ${item.status}`}>
                    {statusText[item.status]}
                  </span>
                </td>
                <td>{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}