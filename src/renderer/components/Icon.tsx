import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'dashboard'
  | 'inbox'
  | 'library'
  | 'review'
  | 'archive'
  | 'settings'
  | 'activity'
  | 'plus'
  | 'folder'
  | 'refresh'
  | 'play'
  | 'alert'
  | 'close'
  | 'check'
  | 'film'
  | 'clock'
  | 'disk'
  | 'download'
  | 'shield'
  | 'scan'
  | 'external'
  | 'chevron'
  | 'spark';

const PATHS: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v10l-3 4H7l-3-4V5Z" />
      <path d="M4 13h5l1.5 2h3L15 13h5" />
    </>
  ),
  library: (
    <>
      <path d="M5 4h5v16H5z" />
      <path d="M12 4h3v16h-3z" />
      <path d="m17 5 3 15" />
    </>
  ),
  review: (
    <>
      <path d="M9 11l2.5 2.5L16 9" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  archive: (
    <>
      <path d="M3 7h18v4H3z" />
      <path d="M5 11v9h14v-9" />
      <path d="M10 15h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </>
  ),
  activity: <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />,
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 6h6l2 3h10v10H3V6Z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.2v.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4 12 5 5L20 6" />,
  film: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 10h4M17 10h4M3 14h4M17 14h4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  disk: (
    <>
      <rect x="3" y="12" width="18" height="8" rx="2" />
      <path d="M5 12V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
      <path d="M7 16h.01M11 16h2" />
    </>
  ),
  download: <path d="M12 3v11M8 10l4 4 4-4M4 20h16" />,
  shield: <path d="M12 3 5 6v5c0 5 3.5 8 7 10 3.5-2 7-5 7-10V6l-7-3Z" />,
  scan: (
    <>
      <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
      <path d="M8 12h8" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />,
};

export function Icon({
  name,
  size = 20,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
