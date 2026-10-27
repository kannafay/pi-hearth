export function WindowCaptionIcon({ action }: { action: 'minimize' | 'maximize' | 'close' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {action === 'minimize' ? (
        <path d="M2.5 7.5h9" />
      ) : action === 'maximize' ? (
        <rect x="2.5" y="2.5" width="9" height="9" rx="0.5" />
      ) : (
        <path d="m2.5 2.5 9 9m0-9-9 9" />
      )}
    </svg>
  )
}
