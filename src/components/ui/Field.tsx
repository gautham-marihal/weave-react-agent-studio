import React from 'react';
import { CircleAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { cn } from '../../utils/styles';

interface FieldProps {
  id: string;
  label: string;
  help?: string;
  error?: string;
  warning?: string;
  technicalName?: string;
  showTechnical?: boolean;
  recommended?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ id, label, help, error, warning, technicalName, showTechnical, recommended, children, className }: FieldProps) {
  return (
    <div id={id} className={cn('scroll-mt-28 rounded-md transition-[box-shadow] duration-200', className)}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <label htmlFor={`${id}-input`} className={cn('text-sm font-medium text-ink', showTechnical && 'font-mono text-[13px]')}>
            {showTechnical && technicalName ? technicalName : label}
          </label>
          {recommended && <span className="text-xs text-accent">Recommended: {recommended}</span>}
          {!showTechnical && technicalName && <span className="sr-only">({technicalName})</span>}
        </div>
      </div>
      {children}
      {error ?
      <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-danger" role="alert">
          <CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p> :
      warning ?
      <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-warning">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {warning}
        </p> :
      null}
      {help && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{showTechnical ? label + ' — ' + help : help}</p>}
    </div>);

}