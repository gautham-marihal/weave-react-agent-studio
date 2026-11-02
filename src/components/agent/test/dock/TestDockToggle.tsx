import React from 'react';
import { MessageSquareIcon } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/styles';
import { useTestDock } from './testDockContext';

/** Opens or shuts the test panel beside the page. Renders nothing outside an agent's workspace. */
export function TestDockToggle({ floating = false }: { floating?: boolean }) {
  const dock = useTestDock();
  if (!dock) return null;
  const active = dock.session.status === 'connecting' || dock.session.status === 'waiting' || dock.session.status === 'live';
  return (
    <Button
      variant={floating ? 'primary' : 'secondary'}
      size={floating ? 'md' : 'sm'}
      aria-pressed={dock.open}
      aria-label={dock.open ? 'Close the test panel' : 'Try it: talk to the agent beside this page'}
      title="Talk to the agent while you edit"
      onClick={() => dock.setOpen(!dock.open)}
      className={cn(floating && 'rounded-full shadow-overlay')}
    >
      <MessageSquareIcon className="h-4 w-4" aria-hidden />
      Try it
      {active && <span className="h-2 w-2 rounded-full bg-success" aria-label="A conversation is going" />}
    </Button>
  );
}
