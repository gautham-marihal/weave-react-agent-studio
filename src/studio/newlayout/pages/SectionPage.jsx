import React, { Suspense, lazy } from 'react';
import { Spinner } from '../../ui.jsx';
import PageShell from '../PageShell.jsx';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));

// A page that is the settings form limited to some sections of the configuration (the tools, the channels, the guardrails...). Everything the form can do
// is here (add, rename, delete with its undo, "used by", the problems under each field); the page gives it a title and says what it is for.
export default function SectionPage({
  title,
  lead,
  keys,
  skipViews,
  hide,
  editor,
  focusRequest,
  onShowJson,
  onOpenJson,
  onShowModels,
  actions,
  parts,
  part,
  onPart,
  children,
}) {
  return (
    <PageShell title={title} lead={lead} actions={actions} parts={parts} part={part} onPart={onPart}>
      {children}
      <Suspense fallback={<Spinner label="Loading the settings" />}>
        <FormEditor
          editor={editor}
          only={keys}
          skipViews={skipViews}
          hide={hide}
          embedded
          focusRequest={focusRequest}
          onShowJson={onShowJson}
          onOpenJson={onOpenJson}
          onShowModels={onShowModels}
        />
      </Suspense>
    </PageShell>
  );
}
