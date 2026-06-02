
export interface AnalysisResult {
  hasModel: boolean;
  isMainProductShot: boolean;
  confidence: number;
}

export async function analyzeImage(imageSource: string | File): Promise<AnalysisResult> {
  let source: string;

  if (typeof imageSource === 'string') {
    source = imageSource;
  } else {
    source = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(imageSource);
    });
  }

  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageSource: source }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "AI 分析请求失败");
  }

  return response.json();
}
