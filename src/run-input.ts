import { readFile } from 'node:fs/promises';

export function parseCapabilityInput(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('capability input must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export async function readCapabilityInput(options: { inputJson?: string; inputFile?: string; stdin?: NodeJS.ReadStream }): Promise<Record<string, unknown>> {
  if (options.inputJson !== undefined) return parseCapabilityInput(options.inputJson);
  if (options.inputFile) return parseCapabilityInput(await readFile(options.inputFile, 'utf8'));
  const stdin = options.stdin ?? process.stdin;
  if (stdin.isTTY) return {};
  return parseCapabilityInput(await readStream(stdin));
}

async function readStream(stream: NodeJS.ReadStream): Promise<string> {
  stream.setEncoding('utf8');
  let data = '';
  for await (const chunk of stream) {
    data += String(chunk);
  }
  return data;
}
