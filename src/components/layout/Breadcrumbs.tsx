import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRightIcon, FolderIcon, HouseIcon, MoreHorizontalIcon } from 'lucide-react';
import { useStudio } from '../../contexts/StudioContext';
import { useBreadcrumbContext } from '../../contexts/BreadcrumbContext';
import { cn } from '../../utils/styles';

export interface BreadcrumbItem {
  id: string;
  label: string;
  path: string;
  isCurrent: boolean;
}
export interface BreadcrumbsProps {
  /**
   * The visual separator between breadcrumb items.
   * Defaults to 'chevron'.
   */
  separator?: 'chevron' | 'slash';
  /**
   * Additional container class names
   */
  className?: string;
  /**
   * Whether to display the house icon before the Home label.
   * Defaults to true.
   */
  showHomeIcon?: boolean;
  /**
   * Maximum items to display on mobile before collapsing middle paths into ellipses dropdown.
   * Defaults to 2 (first item + current item).
   */
  maxItemsMobile?: number;
  /**
   * Maximum items to display on desktop before collapsing intermediate paths.
   * Defaults to 5.
   */
  maxItemsDesktop?: number;
  /**
   * Custom items override if the caller wants to supply fixed breadcrumbs.
   */
  items?: BreadcrumbItem[];
}

const COMMON_ROUTE_LABELS: Record<string, string> = {
  agents: 'Agents',
  knowledge: 'Knowledge',
  calls: 'Calls',
  library: 'Library',
  settings: 'Settings',
  analytics: 'Analytics',
  reports: 'Reports',
  overview: 'Overview',
  signin: 'Sign In',
  build: 'Build',
  test: 'Test',
  release: 'Release',
  monitor: 'Monitor',
  aftercall: 'After the call',
  guardrails: 'Guardrails',
  channels: 'Channels',
  tools: 'Tools',
  billing: 'Billing',
  team: 'Team',
  integrations: 'Integrations',
  webhooks: 'Webhooks',
  audit: 'Audit Log',
  api: 'API',
  keys: 'API Keys',
};

const ACRONYMS = new Set([
  'AI', 'API', 'UI', 'UX', 'ID', 'LLM', 'SIP', 'URL', 'HTTP', 'HTTPS',
  'Q1', 'Q2', 'Q3', 'Q4', 'SDK', 'DB', 'ROI', 'CRM', 'KPI', 'SMS', 'VOIP'
]);

/**
 * Intelligent slug formatter that converts URL slugs like 'q4-reports', 'api-keys',
 * or 'customer_support' into polished human titles ('Q4 Reports', 'API Keys', etc.).
 */
export function formatSegmentSlug(segment: string): string {
  const decoded = decodeURIComponent(segment).trim();
  if (!decoded) return '';

  const lower = decoded.toLowerCase();
  if (COMMON_ROUTE_LABELS[lower]) {
    return COMMON_ROUTE_LABELS[lower];
  }

  // Handle call or session hex IDs (e.g., test-support-bot-f4a1_1729657)
  if (decoded.length > 20 && (decoded.includes('-') || decoded.includes('_'))) {
    const parts = decoded.split(/[-_]/);
    const shortId = parts[parts.length - 1] || decoded.slice(-6);
    return `Call #${shortId.slice(0, 8)}`;
  }

  // Normalize delimiters (hyphens, underscores, dots) into spaces
  const normalized = decoded
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');

  const words = normalized.split(/\s+/).filter(Boolean);

  return words
    .map((word) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      // Handle quarter patterns like Q1, Q2, Q3, Q4
      if (/^q[1-4]$/i.test(word)) return word.toUpperCase();
      // Capitalize first character, lowercase remainder
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function Breadcrumbs({
  separator = 'chevron',
  className,
  showHomeIcon = true,
  maxItemsMobile = 2,
  maxItemsDesktop = 5,
  items: customItemsOverride,
}: BreadcrumbsProps) {
  const location = useLocation();
  const { agents } = useStudio();
  const breadcrumbCtx = useBreadcrumbContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLLIElement>(null);

  // Responsive mobile detection via matchMedia
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 640;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  // Close dropdown on route change
  useEffect(() => {
    setDropdownOpen(false);
  }, [location.pathname]);

  // Lookup agent name map
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a) => {
      const name = a.draft?.config?.meta?.name || a.name || a.id;
      map.set(a.id, name);
    });
    return map;
  }, [agents]);

  // Generate dynamic breadcrumb trail based on current URL path
  const trail: BreadcrumbItem[] = useMemo(() => {
    if (customItemsOverride && customItemsOverride.length > 0) {
      return customItemsOverride;
    }

    const pathname = location.pathname;
    const segments = pathname.split('/').filter(Boolean);

    // Root crumb
    const crumbs: BreadcrumbItem[] = [
      {
        id: 'home',
        label: 'Home',
        path: '/',
        isCurrent: segments.length === 0,
      },
    ];

    if (segments.length === 0) {
      return crumbs;
    }

    let accumulatedPath = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      accumulatedPath += `/${segment}`;
      const isCurrent = i === segments.length - 1;

      // Check context title override for this exact accumulated path or segment
      let label =
        breadcrumbCtx?.customTitles[accumulatedPath] ||
        breadcrumbCtx?.customTitles[segment];

      // If not overridden, check agent map or format slug
      if (!label) {
        if (agentMap.has(segment)) {
          label = agentMap.get(segment)!;
        } else {
          label = formatSegmentSlug(segment);
        }
      }

      // For Weave Studio agents: /agents/:agentId routes to workspace stage
      // If user clicks the agent crumb, route directly to its workspace
      let targetPath = accumulatedPath;
      if (segments[0] === 'agents' && i === 1 && !isCurrent) {
        targetPath = `/agents/${segment}/build`;
      }

      crumbs.push({
        id: `${accumulatedPath}-${i}`,
        label,
        path: targetPath,
        isCurrent,
      });
    }

    return crumbs;
  }, [location.pathname, customItemsOverride, breadcrumbCtx?.customTitles, agentMap]);

  // Determine collapsing based on viewport and total items
  const maxAllowed = isMobile ? maxItemsMobile : maxItemsDesktop;
  const shouldCollapse = trail.length > maxAllowed && trail.length > 2;

  // Split items into visible and collapsed
  let visibleFirst: BreadcrumbItem | null = null;
  let collapsedMiddle: BreadcrumbItem[] = [];
  let visibleLast: BreadcrumbItem | null = null;
  const itemsToRender: BreadcrumbItem[] = trail;

  if (shouldCollapse) {
    visibleFirst = trail[0];
    visibleLast = trail[trail.length - 1];
    collapsedMiddle = trail.slice(1, trail.length - 1);
  }

  const renderSeparator = (key: string) => {
    if (separator === 'slash') {
      return (
        <li
          key={key}
          aria-hidden="true"
          className="text-muted/35 font-mono text-xs select-none px-0.5 shrink-0"
        >
          /
        </li>
      );
    }

    return (
      <li
        key={key}
        aria-hidden="true"
        className="inline-flex items-center text-muted/30 select-none shrink-0"
      >
        <ChevronRightIcon className="h-3.5 w-3.5" />
      </li>
    );
  };

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('w-full flex items-center min-w-0 select-none', className)}
    >
      <ol className="flex items-center gap-1.5 text-[13px] text-ink min-w-0 max-w-full overflow-x-auto no-scrollbar py-0.5">
        {!shouldCollapse ? (
          // Full uncollapsed trail
          itemsToRender.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === itemsToRender.length - 1;

            return (
              <React.Fragment key={item.id}>
                {index > 0 && renderSeparator(`sep-${item.id}`)}
                <li className="inline-flex items-center min-w-0 shrink-0">
                  {isLast ? (
                    // Current active page: distinct muted text state + disabled pointer events
                    <span
                      aria-current="page"
                      className="text-muted font-medium select-none pointer-events-none cursor-default truncate max-w-[160px] sm:max-w-[260px] md:max-w-[340px]"
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  ) : (
                    // Historical path link: responsive underline hover state
                    <Link
                      to={item.path}
                      className="text-ink-soft hover:text-ink hover:underline underline-offset-2 transition-colors duration-150 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm font-medium"
                    >
                      {isFirst && showHomeIcon && (
                        <HouseIcon
                          className="h-3.5 w-3.5 text-muted hover:text-ink transition-colors shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className="truncate max-w-[130px] sm:max-w-[180px] md:max-w-[240px]"
                        title={item.label}
                      >
                        {item.label}
                      </span>
                    </Link>
                  )}
                </li>
              </React.Fragment>
            );
          })
        ) : (
          // Collapsed trail on mobile (or long paths): Home > ... (dropdown menu) > Active Page
          <>
            {/* First Item (Home) */}
            {visibleFirst && (
              <li className="inline-flex items-center min-w-0 shrink-0">
                <Link
                  to={visibleFirst.path}
                  className="text-ink-soft hover:text-ink hover:underline underline-offset-2 transition-colors duration-150 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm font-medium"
                >
                  {showHomeIcon && (
                    <HouseIcon
                      className="h-3.5 w-3.5 text-muted hover:text-ink transition-colors shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate max-w-[100px] sm:max-w-[140px]" title={visibleFirst.label}>
                    {visibleFirst.label}
                  </span>
                </Link>
              </li>
            )}

            {renderSeparator('sep-first')}

            {/* Collapsed Ellipses Dropdown Button */}
            <li className="relative inline-flex items-center shrink-0" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((prev) => !prev)}
                className={cn(
                  'inline-flex h-6 items-center justify-center rounded-md border border-line/70 bg-subtle/50 px-1.5 text-xs font-semibold text-muted transition-all duration-150',
                  'hover:border-line-strong hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  dropdownOpen && 'border-accent/40 bg-accent-soft/30 text-accent'
                )}
                aria-label="Show intermediate breadcrumb paths"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                title="Show intermediate path segments"
              >
                <MoreHorizontalIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              {/* Collapsed Dropdown Menu */}
              {dropdownOpen && (
                <div
                  role="menu"
                  aria-label="Collapsed breadcrumbs"
                  className="absolute left-0 top-full mt-1.5 z-50 min-w-[200px] max-w-[280px] rounded-xl border border-line bg-surface p-1.5 shadow-overlay backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Intermediate Pages
                  </div>
                  <div className="space-y-0.5">
                    {collapsedMiddle.map((item) => (
                      <Link
                        key={item.id}
                        to={item.path}
                        role="menuitem"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-subtle hover:text-ink transition-colors focus-visible:outline-none focus-visible:bg-subtle focus-visible:text-ink"
                      >
                        <FolderIcon className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </li>

            {renderSeparator('sep-last')}

            {/* Current Active Page */}
            {visibleLast && (
              <li className="inline-flex items-center min-w-0 shrink-0">
                <span
                  aria-current="page"
                  className="text-muted font-medium select-none pointer-events-none cursor-default truncate max-w-[150px] sm:max-w-[240px] md:max-w-[320px]"
                  title={visibleLast.label}
                >
                  {visibleLast.label}
                </span>
              </li>
            )}
          </>
        )}
      </ol>
    </nav>
  );
}
