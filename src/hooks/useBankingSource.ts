import { useEffect, useState } from 'react';
import { bankingSource, rehearsalSource, type BankingSource } from '../api/gateway';

/**
 * Where banking calls go on this page (src/api/gateway.ts bankingSource); null while it is being found out, or when
 * `wanted` is false (a screen that only needs it for a banking agent does not ask the gateway otherwise).
 * `which: 'rehearsal'` asks where Studio's own test sessions go instead (rehearsalSource: the mock bank, always).
 */
export function useBankingSource(wanted = true, which: 'calls' | 'rehearsal' = 'calls'): BankingSource | null {
  const [source, setSource] = useState<BankingSource | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void (which === 'rehearsal' ? rehearsalSource() : bankingSource()).then((s) => {
      if (current) setSource(s);
    });
    return () => {
      current = false;
    };
  }, [wanted, which]);
  return wanted ? source : null;
}
