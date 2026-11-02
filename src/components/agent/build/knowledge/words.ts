import { formatDateTime } from '../../../../utils/format';

/** A server time as "23 Oct 2026, 09:00", or '' when it is missing or not a time (never an error on screen). */
export function whenInWords(iso: string | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return formatDateTime(iso);
}
