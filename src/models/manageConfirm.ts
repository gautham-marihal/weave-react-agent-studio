// "Are you sure?" as a promise, for actions that change something that can't be taken back (release a number, delete a
// workspace, remove a template). Studio asks in its own dialog (components/manage/ConfirmHost.tsx draws it); where no
// host is on the page the browser's own box asks, so a decision is never skipped.

export interface ConfirmRequest {
  kind: 'confirm' | 'notice';
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
  resolve: (answer: boolean) => void;
}

type Host = (request: ConfirmRequest | null) => void;
const hosts = new Set<Host>();
let open: ConfirmRequest | null = null;

/** A host draws the question; it is told null when there is nothing to ask. Returns how to stop listening. */
export function subscribeDialogs(host: Host): () => void {
  hosts.add(host);
  return () => {
    hosts.delete(host);
  };
}

function ask(kind: ConfirmRequest['kind'], { title, body, confirmLabel, tone }: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> {
  if (!hosts.size) {
    const words = body ? `${title}\n\n${body}` : title;
    const win = typeof window === 'undefined' ? null : window;
    if (kind === 'notice') {
      win?.alert?.(words);
      return Promise.resolve(true);
    }
    return Promise.resolve(!!win?.confirm?.(words));
  }
  // a second question replaces the first, which counts as declined
  open?.resolve(false);
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      kind,
      title,
      body,
      confirmLabel,
      tone,
      resolve: (answer) => {
        if (open === request) {
          open = null;
          hosts.forEach((h) => h(null));
        }
        resolve(answer);
      },
    };
    open = request;
    hosts.forEach((h) => h(request));
  });
}

/** Resolves true when the person agrees. */
export const askConfirm = (question: Omit<ConfirmRequest, 'kind' | 'resolve'>): Promise<boolean> => ask('confirm', question);

/** A message with one button; resolves when it is closed. */
export const showNotice = (notice: Omit<ConfirmRequest, 'kind' | 'resolve' | 'tone'>): Promise<boolean> => ask('notice', notice);
