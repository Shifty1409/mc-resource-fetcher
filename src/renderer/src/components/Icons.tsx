import type { JSX, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (props: P): P => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props
})

export const IconHome = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.5 20v-5.5h5V20" />
  </svg>
)

export const IconDownload = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
)

export const IconCube = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="m4 7.5 8 4.5 8-4.5" />
    <path d="M12 21v-9" />
  </svg>
)

export const IconSettings = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.4 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10.3 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.6 11a2 2 0 1 1 0 4z" />
  </svg>
)

export const IconPlay = (p: P): JSX.Element => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5-11-6.5z" />
  </svg>
)

export const IconFolder = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10z" />
  </svg>
)

export const IconTrash = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6.5 7 7 20h10l.5-13" />
    <path d="M10.5 11v5M13.5 11v5" />
  </svg>
)

export const IconSearch = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
)

export const IconX = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
)

export const IconChevron = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const IconRefresh = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 5v6h-6" />
  </svg>
)

export const IconPlus = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconAlert = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 4 2.5 20h19L12 4z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </svg>
)

export const IconCheck = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
)

export const IconConsole = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="m7 10 2.5 2.5L7 15M12.5 15H17" />
  </svg>
)

export const IconJava = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M9 17c-2.5 1.2 1 2.2 3.5 2.2 2 0 4.5-.6 4.5-2.2 0-1.4-1.6-1.8-3-2" />
    <path d="M11.5 13.5c-1.4-1.2.3-2 1-3.2.5-.9.6-2-.4-3" />
    <path d="M8 9c4-2.4 6-5 5.5-7" />
    <path d="M14.5 8.5c2 .8 2.5 2.2 1 3.5" />
  </svg>
)

export const IconLink = (p: P): JSX.Element => (
  <svg {...base(p)}>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  </svg>
)
