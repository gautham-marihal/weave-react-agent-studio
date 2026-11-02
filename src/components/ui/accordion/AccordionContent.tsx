import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAccordionItem } from './AccordionContext';
import { cn } from '../../../utils/styles';
import type { AccordionContentProps } from './types';

export function AccordionContent({ className, children }: AccordionContentProps) {
  const { id, isExpanded } = useAccordionItem();

  return (
    <AnimatePresence initial={false}>
      {isExpanded && (
        <motion.div
          id={`accordion-content-${id}`}
          role="region"
          aria-labelledby={`accordion-header-${id}`}
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: 'auto',
            opacity: 1,
            transition: {
              height: { duration: 0.22, ease: [0.04, 0.62, 0.23, 0.98] },
              opacity: { duration: 0.18, delay: 0.05 },
            },
          }}
          exit={{
            height: 0,
            opacity: 0,
            transition: {
              height: { duration: 0.18, ease: [0.04, 0.62, 0.23, 0.98] },
              opacity: { duration: 0.1 },
            },
          }}
          className="overflow-hidden rounded-b-xl"
        >
          <div
            className={cn(
              'border-t border-line/70 bg-canvas/20 p-5 sm:p-6 text-sm text-ink-soft',
              className
            )}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
