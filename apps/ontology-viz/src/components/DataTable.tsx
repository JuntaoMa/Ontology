import type { ReactNode } from "react";

export interface DataTableColumn {
  key: string;
  label: string;
  width?: string;
}

export interface DataTableRow {
  id: string;
  cells: Record<string, ReactNode>;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: DataTableRow[];
}

export function DataTable({ columns, rows }: DataTableProps) {
  if (!rows.length) return null;
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column.key}>{row.cells[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
