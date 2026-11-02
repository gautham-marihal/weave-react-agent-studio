import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { cn, inputClass } from '../../../utils/styles';
import type { AccordionPaginationProps } from './types';

export function AccordionPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20, 50],
  className,
}: AccordionPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const startItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  // Generate page numbers with ellipses
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push('ellipsis');

      const start = Math.max(2, safePage - 1);
      const end = Math.min(totalPages - 1, safePage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (safePage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 border-t border-line/70 pt-4 text-xs text-muted',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-medium text-ink">{startItem}</span>–
          <span className="font-medium text-ink">{endItem}</span> of{' '}
          <span className="font-medium text-ink">{totalItems}</span>
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-muted">Per page:</span>
            <Tooltip content="Change number of items per page" position="top">
              <select
                aria-label="Items per page"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className={cn(inputClass, 'w-auto py-1 px-2 text-xs font-medium cursor-pointer')}
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Tooltip
          content={safePage <= 1 ? 'First page reached' : 'Previous page'}
          position="top"
        >
          <span>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => onPageChange(safePage - 1)}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors',
                'hover:bg-subtle hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:border-line'
              )}
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
          </span>
        </Tooltip>

        <div className="flex items-center gap-1 px-1">
          {getPageNumbers().map((p, idx) => {
            if (p === 'ellipsis') {
              return (
                <span key={`ellipsis-${idx}`} className="px-1 text-muted">
                  …
                </span>
              );
            }

            const isCurrent = p === safePage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 min-w-[32px] items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors',
                  isCurrent
                    ? 'bg-accent text-white shadow-sm font-semibold'
                    : 'border border-line bg-surface text-ink hover:bg-subtle hover:border-line-strong'
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <Tooltip
          content={safePage >= totalPages ? 'Last page reached' : 'Next page'}
          position="top"
        >
          <span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(safePage + 1)}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors',
                'hover:bg-subtle hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface disabled:hover:border-line'
              )}
              aria-label="Next page"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
