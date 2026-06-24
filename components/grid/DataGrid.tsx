'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry, AllCommunityModule, themeQuartz,
  type ColDef, type GridApi, type GridReadyEvent, type CellValueChangedEvent,
} from 'ag-grid-community';
import * as XLSX from 'xlsx';
import { useGridView, GridViewModal } from '@/components/grid/useGridView';

// Register all community features once (sorting, filtering, editing, CSV export, …).
ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({ headerHeight: 36, rowHeight: 40, fontSize: 13 });

/** Renderer: show an <img> thumbnail when the cell value is an image URL. */
export function ImageCell(props: { value?: unknown }) {
  const v = String(props.value ?? '');
  if (!/^https?:\/\//i.test(v) || !/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v)) {
    return <span>{v}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <a href={v} target="_blank" rel="noreferrer"><img src={v} alt="" className="h-9 w-9 object-contain bg-gray-50 rounded border" /></a>;
}

export interface DataGridHandle { api: GridApi | null; }

interface Props<T> {
  rowData: T[];
  columnDefs: ColDef<T>[];
  getRowId?: (p: { data: T }) => string;
  onCellValueChanged?: (e: CellValueChangedEvent<T>) => void;
  loading?: boolean;
  /** Custom toolbar content on the left (buttons, progress…). */
  toolbarLeft?: React.ReactNode;
  /** Filename (without extension) for exports. */
  exportName?: string;
  heightClass?: string;
  rowHeight?: number;
  /** Enables the persistent column-view editor (Strapi-like). Unique storage key per grid. */
  viewKey?: string;
  /** Paginate (default) or use a single virtual-scroll list (false). */
  pagination?: boolean;
}

export default function DataGrid<T>({
  rowData, columnDefs, getRowId, onCellValueChanged, loading,
  toolbarLeft, exportName = 'export', heightClass = 'h-[calc(100vh-150px)]', rowHeight, viewKey,
  pagination = true,
}: Props<T>) {
  const apiRef = useRef<GridApi<T> | null>(null);
  const [quick, setQuick] = useState('');
  const [showView, setShowView] = useState(false);
  const { applied, view, persist, reset } = useGridView<T>(viewKey, columnDefs);

  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true, filter: true, resizable: true, floatingFilter: true, minWidth: 90,
  }), []);

  const onGridReady = useCallback((e: GridReadyEvent<T>) => { apiRef.current = e.api; }, []);

  const exportCsv = () => apiRef.current?.exportDataAsCsv({ fileName: `${exportName}.csv` });

  // XLSX of the currently displayed columns × filtered/sorted rows (SheetJS).
  const exportXlsx = () => {
    const api = apiRef.current;
    if (!api) return;
    const displayed = api.getAllDisplayedColumns();
    const cells = displayed.map((c) => ({ field: c.getColDef().field as string | undefined, header: String(c.getColDef().headerName ?? c.getColId()) }))
      .filter((c) => c.field);
    const rows: Record<string, unknown>[] = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      const d = node.data as Record<string, unknown> | undefined;
      if (!d) return;
      const row: Record<string, unknown> = {};
      for (const c of cells) row[c.header] = d[c.field!];
      rows.push(row);
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dane');
    XLSX.writeFile(wb, `${exportName}.xlsx`);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">{toolbarLeft}</div>
        <input
          className="input w-56" placeholder="Szukaj w tabeli…"
          value={quick}
          onChange={(e) => { setQuick(e.target.value); apiRef.current?.setGridOption('quickFilterText', e.target.value); }}
        />
        {viewKey && (
          <button className="btn-secondary btn-sm" onClick={() => setShowView(true)}>Widok</button>
        )}
        <button className="btn-secondary btn-sm" onClick={exportCsv}>CSV</button>
        <button className="btn-secondary btn-sm" onClick={exportXlsx}>XLSX</button>
      </div>

      <div className={`w-full ${heightClass}`}>
        <AgGridReact<T>
          theme={theme}
          rowData={rowData}
          columnDefs={applied}
          defaultColDef={defaultColDef}
          getRowId={getRowId ? (p) => getRowId({ data: p.data }) : undefined}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          loading={loading}
          rowHeight={rowHeight}
          suppressFieldDotNotation
          pagination={pagination}
          paginationPageSize={100}
          paginationPageSizeSelector={[50, 100, 200, 500]}
          animateRows={false}
          enableCellTextSelection
          ensureDomOrder
        />
      </div>

      {showView && view && (
        <GridViewModal view={view} persist={persist} reset={reset} onClose={() => setShowView(false)} />
      )}
    </div>
  );
}
