export function Header() {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Semir AI Quality Control</p>
        <h1>森马主图质检助手</h1>
        <p className="header-desc">
          面向商品上新流程的模拍主图识别、异常提示与结果导出工具。
        </p>
      </div>

      <div className="header-badge">
        <span className="status-dot" />
        测试环境
      </div>
    </header>
  );
}