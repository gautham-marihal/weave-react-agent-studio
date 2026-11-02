import React from 'react';

export interface AccordionPaginationConfig {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export interface AccordionProps<T = any> {
  items?: T[];
  getId?: (item: T) => string;
  onReorder?: (newItems: T[]) => void;
  onReorderById?: (sourceId: string, targetId: string, position: 'top' | 'bottom') => void;
  allowMultiple?: boolean;
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  enableReordering?: boolean;
  enableDragAndDrop?: boolean;
  renderOverlay?: (item: T) => React.ReactNode;
  pagination?: AccordionPaginationConfig;
  className?: string;
  children?: React.ReactNode;
}

export interface AccordionItemProps {
  id: string;
  index?: number;
  isFirst?: boolean;
  isLast?: boolean;
  disabled?: boolean;
  hasProblem?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export interface AccordionHeaderProps {
  id?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  status?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  showDragHandle?: boolean;
  tooltipText?: string;
  hasProblem?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export interface AccordionContentProps {
  className?: string;
  children?: React.ReactNode;
}

export interface AccordionPaginationProps extends AccordionPaginationConfig {
  className?: string;
}
