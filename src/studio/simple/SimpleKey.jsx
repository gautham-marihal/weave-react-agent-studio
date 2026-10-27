import React, { createContext, useContext } from 'react';
import { TechName } from '../form/TechName.jsx';
import { useTechnicalNames } from '../usePref.js';

// "Technical names" on the agent's own pages: each setting's path in the config, to copy or open in the JSON.
// A page's own fields aren't inside the settings form, so the way to open the JSON comes from this context.
export const JsonOpenerCtx = createContext(null);

export default function SimpleKey({ path }) {
  const [technical] = useTechnicalNames();
  const openInJson = useContext(JsonOpenerCtx);
  if (!technical || !path || !path.length) return null;
  return <TechName name={String(path[path.length - 1])} path={path} onOpenJson={openInJson || undefined} />;
}
