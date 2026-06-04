export type ModelshotStatus = "passed" | "warning" | "failed" | "pending";

export interface ModelshotResult {
  id: string;
  productLine: string;
  imageOneToOne: string;
  imageThreeToFour: string;
  isModelshot: boolean | null;
  confidence: number | null;
  reason: string;
  status: ModelshotStatus;
}