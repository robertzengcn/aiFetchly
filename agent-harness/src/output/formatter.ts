/**
 * Output formatter - renders data as tables (human) or JSON (machine).
 */

import chalk from "chalk";
import Table from "cli-table3";
import type { TableConfig, PaginatedResult } from "../common/types";
import { printJson, printErrorJson } from "./envelope";

/** Format and output data based on jsonMode flag */
export function formatOutput<T>(
  data: T,
  jsonMode: boolean,
  command: string,
  tableConfig?: TableConfig
): void {
  if (jsonMode) {
    printJson(data, command);
    return;
  }

  if (tableConfig && data && typeof data === "object") {
    renderTable(data, tableConfig);
  } else if (Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

/** Format paginated data */
export function formatPaginated<T>(
  result: PaginatedResult<T>,
  jsonMode: boolean,
  command: string,
  tableConfig: TableConfig
): void {
  if (jsonMode) {
    printJson(result, command);
    return;
  }

  renderTable(result.items, tableConfig);
  console.log(
    chalk.gray(
      `\nPage ${result.page}/${result.totalPages} | Total: ${result.total} items | Size: ${result.size}`
    )
  );
}

/** Format a single item */
export function formatItem(
  item: unknown,
  jsonMode: boolean,
  command: string,
  fields: Array<{ key: string; label: string }>
): void {
  if (jsonMode) {
    printJson(item, command);
    return;
  }

  const record = item as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field.key];
    console.log(`  ${chalk.cyan(field.label + ":")} ${formatValue(value)}`);
  }
}

/** Format an error */
export function formatError(
  error: unknown,
  jsonMode: boolean,
  command: string
): void {
  const message = error instanceof Error ? error.message : String(error);

  if (jsonMode) {
    printErrorJson(message, command);
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
}

/** Render a table from data and column config */
function renderTable(data: unknown, config: TableConfig): void {
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0) {
    console.log(chalk.yellow("No results found."));
    return;
  }

  const table = new Table({
    head: config.columns.map((c) => chalk.cyan.bold(c.header)),
    colWidths: config.columns.map((c) => c.width ?? null),
    style: { "padding-left": 1, "padding-right": 1 },
  });

  for (const item of items) {
    const row = config.columns.map((col) => {
      const raw = (item as Record<string, unknown>)[col.key];
      return col.transform ? col.transform(raw) : formatValue(raw);
    });
    table.push(row);
  }

  if (config.title) {
    console.log(chalk.bold(`\n${config.title}`));
  }
  console.log(table.toString());
}

/** Format a value for display */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return chalk.gray("-");
  if (typeof value === "boolean")
    return value ? chalk.green("yes") : chalk.red("no");
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

/** Format a success message */
export function formatSuccess(
  message: string,
  jsonMode: boolean,
  command: string
): void {
  if (jsonMode) {
    printJson({ message }, command);
  } else {
    console.log(chalk.green(`✓ ${message}`));
  }
}

/** Format a warning message */
export function formatWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}
