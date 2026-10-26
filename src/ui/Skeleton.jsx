import React from 'react';

// A shape where words or numbers will be while they are read, so the page keeps its layout and nothing jumps when they arrive. A screen reader hears
// one "Loading" for the group (SkeletonRows), not every shape.
export function Skeleton({ width = '60%', height = 12, round = false, className = '' }) {
  return <span className={`skeleton ${round ? 'round' : ''} ${className}`} style={{ width, height }} aria-hidden="true" />;
}

// A few rows the size of list rows: a small square, a line and a shorter line under it.
export function SkeletonRows({ rows = 3, label = 'Loading', square = true }) {
  return (
    <div className="skeletonRows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeletonRow">
          {square && <Skeleton width={32} height={32} />}
          <span>
            <Skeleton width={`${46 - i * 6}%`} />
            <Skeleton width={`${70 - i * 8}%`} height={10} />
          </span>
        </div>
      ))}
    </div>
  );
}
