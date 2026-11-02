/**
 * The address's query as it is now, to change and pass to setParams. The router re-renders in a transition, so the
 * `params` a click handler closed over can be one change behind: a filter, then a quick change of sort, would put the
 * old filter back.
 */
export const currentSearchParams = (): URLSearchParams => new URLSearchParams(window.location.search);
