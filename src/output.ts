export type OutputFormat = 'json' | 'ndjson' | 'csv' | 'md' | 'table';

export function render(data: unknown, format: OutputFormat): string {
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [data as Record<string, unknown>];
  if (format === 'json') return `${JSON.stringify(data, null, 2)}\n`;
  if (format === 'ndjson') return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  if (format === 'csv') return renderCsv(rows);
  if (format === 'md') return renderMarkdown(rows);
  return renderTable(rows);
}

export function pickFields<T extends Record<string, unknown>>(rows: T[], fields: string[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])));
}

function renderCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`
  ];
  for (const row of rows) {
    lines.push(`| ${columns.map((column) => String(row[column] ?? '')).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function renderTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '(no data)\n';
  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => visibleLength(row[column]))));
  const line = (values: unknown[]) => values.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  ');
  return `${line(columns)}\n${line(widths.map((width) => '-'.repeat(width)))}\n${rows.map((row) => line(columns.map((column) => row[column]))).join('\n')}\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function visibleLength(value: unknown): number {
  return String(value ?? '').length;
}
