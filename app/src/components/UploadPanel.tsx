import { useRef, useState } from "react";

interface UploadPanelProps {
  onUseDemo: () => void;
  onClear: () => void;
}

export function UploadPanel({ onUseDemo, onClear }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setFileName(file.name);

    // 第一阶段先只完成上传 UI。
    // 下一阶段再接 Excel 解析和 Gemini 识别接口。
  }

  return (
    <section className="panel upload-panel">
      <div>
        <p className="section-label">Step 01</p>
        <h2>上传产品线工作表</h2>
        <p>
          支持上传包含主 ID、产品线、1:1 主图链接、3:4 主图链接的 Excel 或 CSV 文件。
        </p>
      </div>

      <div className="upload-box" onClick={() => fileInputRef.current?.click()}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          hidden
        />

        <div className="upload-icon">↑</div>
        <strong>{fileName || "点击选择 Excel / CSV 文件"}</strong>
        <span>建议字段：主 ID、产品线、1:1 主图、3:4 主图</span>
      </div>

      <div className="button-row">
        <button className="primary-button" type="button" onClick={onUseDemo}>
          使用示例数据
        </button>

        <button className="secondary-button" type="button" onClick={onClear}>
          清空结果
        </button>
      </div>
    </section>
  );
}