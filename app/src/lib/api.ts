import type { ModelshotResult } from "./types";

export async function uploadModelshotFile(file: File): Promise<ModelshotResult[]> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/modelshot/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("文件上传或识别失败，请稍后重试");
  }

  return response.json();
}