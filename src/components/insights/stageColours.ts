import type { StageId } from '../../models/speed';

/** Each part of a wait has its own colour, the same in the bars, the table and the agents' table. */
export const STAGE_COLOUR: Record<StageId, string> = {
  listen: 'bg-info',
  think: 'bg-accent',
  systems: 'bg-warning',
  reply: 'bg-success',
  other: 'bg-line-strong',
};
