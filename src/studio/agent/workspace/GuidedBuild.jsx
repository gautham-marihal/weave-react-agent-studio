import React from 'react';
import Icon from '../../../ui/Icon.jsx';
import { VoiceFields } from '../../setup/StepFields.jsx';
import { ActionSwitches, KnowledgeBlock, ReachChoices } from '../../setup/SimpleBlocks.jsx';
import { PURPOSE } from '../buildSections.js';
import GuidedSection from './GuidedSection.jsx';
import IdentityFields from './IdentityFields.jsx';

// Build's Guided view: every part of the agent on one page, in build order, each with its plain controls and a link to
// all its settings. The checks sit beside it (BuildStage).
//   sections: where each part stands (buildSections.js); problems: how many the checks found, by page
//   simpleKnowledge: the documents are the setup's single base, so they can be added here; otherwise point to the page
//   latest(): the draft as it is now (an upload finishes after more edits); onUploaded: reads the documents again

// The parts in order: who it is and how it sounds (both on the Agent page), then the rest of Build. A part with no
// plain controls describes its page (`more`) with a button to it (`open`).
const GUIDED = [
  { id: 'who', page: 'agent', title: 'Personality and instructions', text: 'Who the agent is and what it should do. This shapes every reply.' },
  { id: 'sound', page: 'agent', title: 'Language and voice', text: 'The language it speaks first, any others it answers in, and how it sounds on a call.' },
  { id: 'knowledge', page: 'knowledge', title: 'What it knows', text: PURPOSE.knowledge },
  { id: 'tools', page: 'tools', title: 'What it can do', text: PURPOSE.tools },
  { id: 'channels', page: 'channels', title: 'Where people reach it', text: PURPOSE.channels },
  {
    id: 'workflow',
    page: 'workflow',
    title: 'How a conversation moves',
    text: PURPOSE.workflow,
    open: 'Open the canvas',
    more: 'See who answers first, add more agents, and choose when one hands a conversation to another, all on one picture.',
  },
  {
    id: 'guardrails',
    page: 'guardrails',
    title: 'Its boundaries',
    text: PURPOSE.guardrails,
    open: 'Set its boundaries',
    more: 'Choose the topics it keeps to or stays away from, when it passes someone to your team, and when it ends a call.',
  },
  {
    id: 'aftercall',
    page: 'aftercall',
    title: 'After the call',
    text: PURPOSE.aftercall,
    open: 'Choose what happens',
    more: 'Have it write a summary of every call, answer your own questions about each one, and choose what is kept and for how long.',
  },
];

export default function GuidedBuild({ botId, config, set, latest, sections, problems = {}, simpleKnowledge = true, onUploaded, onOpen }) {
  const partOf = (page) => sections.find((s) => s.id === page);
  // an agent with knowledge bases of its own keeps its documents on the Knowledge page
  const knowledgeElsewhere = !simpleKnowledge;

  const controls = (g) => {
    if (g.id === 'who') return <IdentityFields config={config} set={set} />;
    if (g.id === 'sound') return <VoiceFields config={config} set={set} />;
    if (g.id === 'knowledge' && !knowledgeElsewhere)
      return <KnowledgeBlock botId={botId} config={config} set={set} latest={latest} onPage onUploaded={onUploaded} />;
    if (g.id === 'tools') return <ActionSwitches config={config} set={set} onPage />;
    if (g.id === 'channels') return <ReachChoices config={config} set={set} botId={botId} onPage />;
    // no plain controls: say what the page is for, with a button to it
    return (
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-4 tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface tw-p-5">
        <p className="tw-m-0 tw-max-w-[520px] tw-text-md tw-leading-relaxed tw-text-ink-soft">
          {g.more || 'Its documents are set up on its own page, with every knowledge base it has.'}
        </p>
        <button type="button" className="quietButton compactCta tw-inline-flex tw-items-center tw-gap-2" onClick={() => onOpen(g.page)}>
          {g.open || 'Open its documents'} <Icon name="arrowRight" size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="tw-min-w-0">
      {GUIDED.map((g) => {
        const own = !g.open && !(g.id === 'knowledge' && knowledgeElsewhere);
        return (
          <GuidedSection
            key={g.id}
            id={g.id}
            title={g.title}
            text={g.text}
            // the Agent page's two parts share one status line, shown once beside the first
            part={g.id === 'sound' ? null : partOf(g.page)}
            problems={g.id === 'sound' ? 0 : problems[g.page] || 0}
            // a part with plain controls links to more on its page; one without has the button in its controls instead
            onMore={own ? () => onOpen(g.page) : null}
          >
            {controls(g)}
          </GuidedSection>
        );
      })}
    </div>
  );
}
