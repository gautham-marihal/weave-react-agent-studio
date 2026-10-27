import React, { Suspense, lazy } from 'react';
import { Spinner } from '../../ui.jsx';
import PageShell from '../PageShell.jsx';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));

// A page that is the settings form limited to some config sections (tools, channels, guardrails...), with a title and
// lead. Everything the form can do works here.
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
  partsInHead = false,
  children,
}) {
  return (
    <PageShell title={title} lead={lead} actions={actions} parts={parts} part={part} onPart={onPart} partsInHead={partsInHead}>
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
