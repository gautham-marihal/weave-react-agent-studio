import { Dialog } from './Dialog';
import { Button } from './Button';
import { redoLabel, shortcutLabel } from '../../utils/keys';

interface HelpShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

// Only shortcuts that are wired up, named as they read on this keyboard (⌘ on a Mac, Ctrl elsewhere).
const shortcuts = [
  { key: shortcutLabel('S'), label: 'Save', desc: 'Save the draft, from any page of an agent' },
  { key: shortcutLabel('K'), label: 'Search', desc: 'Jump to any agent, page or setting' },
  { key: shortcutLabel('Z'), label: 'Undo', desc: 'Undo the last change to the draft (outside text fields)' },
  { key: redoLabel(), label: 'Redo', desc: 'Put back the change you undid (outside text fields)' },
  { key: '↑ ↓ Enter', label: 'Move and open', desc: 'Move through search results and open one' },
  { key: 'Esc', label: 'Close', desc: 'Close a dialog, a menu, the search or the phone menu' },
  { key: '?', label: 'Help', desc: 'Open this list from any page (not while typing)' },
];

// Where each kind of work is done, in the studio's own words.
const places = [
  {
    title: 'An agent’s pages',
    text: 'Open an agent from Agents. Overview says how far it is from ready and opens the next step; then Build (what it says and does), Test, Release and Monitor.',
  },
  {
    title: 'Test',
    text: 'In each agent: talk or type to the draft before anyone else does, and run its saved tests.',
  },
  {
    title: 'Publish and deploy',
    text: 'Publish freezes the draft as a version. Release puts a version in Development, Staging or Production, or rolls one back.',
  },
  {
    title: 'Calls and Live',
    text: 'Calls lists finished calls of every agent with their transcripts; Live shows the calls happening now.',
  },
  {
    title: 'Library',
    text: 'Voices, model providers, integrations and phone numbers, shared by every agent. Knowledge holds the documents agents answer from.',
  },
  {
    title: 'Team and Settings',
    text: 'Team lists who works here (kept in this browser for now). Settings has your account, how the studio looks, the data source and working environment, the API’s state, and what is running where. Your account, help and sign out are also under your initials at the top right.',
  },
];

export function HelpShortcutsModal({ open, onClose }: HelpShortcutsModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Help & shortcuts"
      description={`Keys that work in the studio, and where things are. Edits stay unsaved until you press Save or ${shortcutLabel('S')}.`}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="help-keys">
          <h3 id="help-keys" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Keyboard shortcuts
          </h3>
          <div className="divide-y divide-line rounded-lg border border-line bg-surface text-xs">
            {shortcuts.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <span className="font-semibold text-ink">{item.label}</span>
                  <p className="text-[11px] text-muted">{item.desc}</p>
                </div>
                <kbd className="shrink-0 rounded border border-line bg-subtle px-2 py-1 font-mono text-[11px] font-semibold text-ink">{item.key}</kbd>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="help-places">
          <h3 id="help-places" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Where things live
          </h3>
          <ul className="space-y-3">
            {places.map((p) => (
              <li key={p.title} className="text-[13px] leading-relaxed">
                <strong className="block font-semibold text-ink">{p.title}</strong>
                <span className="text-ink-soft">{p.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
