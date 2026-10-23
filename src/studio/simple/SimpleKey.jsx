import React, { createContext, useContext } from 'react';
import { TechName } from '../form/TechName.jsx';
import { useTechnicalNames } from '../usePref.js';

// In the Simple view, "Technical names" shows where each setting lives in the configuration file (its path), with a way to copy it or open it in the JSON,
// just as it does in the settings form. A page's own fields aren't inside the form, so the way to open the JSON comes from here.
export const JsonOpenerCtx = createContext(null);

export default function SimpleKey({ path }) {
  const [technical] = useTechnicalNames();
  const openInJson = useContext(JsonOpenerCtx);
  if (!technical || !path || !path.length) return null;
  return <TechName name={String(path[path.length - 1])} path={path} onOpenJson={openInJson || undefined} />;
}
