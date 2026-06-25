export function extractActionArgs(raw: unknown[]): string[] {
  const commandIndex = raw.findIndex(isCommandLike);
  const positional = commandIndex >= 0 ? raw.slice(0, commandIndex) : raw;
  const args: string[] = [];

  for (const item of positional) {
    if (Array.isArray(item)) {
      args.push(...item.map(String));
      continue;
    }
    if (item === undefined || item === null) continue;
    if (typeof item === 'object') continue;
    args.push(String(item));
  }

  return args;
}

export function extractActionCommand<T>(raw: unknown[]): T {
  const command = raw.find(isCommandLike);
  if (!command) throw new Error('Commander action did not provide a command object');
  return command as T;
}

function isCommandLike(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as { optsWithGlobals?: unknown }).optsWithGlobals === 'function';
}
