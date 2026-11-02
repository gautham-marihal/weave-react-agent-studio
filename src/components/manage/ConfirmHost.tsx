import React, { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { subscribeDialogs, type ConfirmRequest } from '../../models/manageConfirm';

/** Draws the questions askConfirm/showNotice ask (models/manageConfirm.ts). Mount one per page that asks. */
export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  useEffect(() => subscribeDialogs(setRequest), []);
  const answer = (yes: boolean) => request?.resolve(yes);
  return (
    <Dialog
      open={!!request}
      onClose={() => answer(false)}
      title={request?.title ?? ''}
      footer={
        request?.kind === 'notice' ?
        <Button variant="primary" onClick={() => answer(true)}>OK</Button> :

        <>
            <Button variant="ghost" onClick={() => answer(false)}>Cancel</Button>
            <Button variant={request?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => answer(true)}>
              {request?.confirmLabel || 'Continue'}
            </Button>
          </>
      }>
      {request?.body ?
      <div className="space-y-2 text-sm leading-relaxed text-ink-soft">
          {request.body.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
        </div> :

      <p className="text-sm text-ink-soft">{request?.kind === 'notice' ? '' : 'Are you sure?'}</p>
      }
    </Dialog>);

}
