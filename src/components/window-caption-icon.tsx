export function WindowCaptionIcon({ action }: { action: 'minimize' | 'maximize' | 'close' }) {
  return (
    <svg aria-hidden viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1">
      {action === 'minimize' ? (
        <path d="M2 7.5h10" />
      ) : action === 'maximize' ? (
        <rect x="2.5" y="2.5" width="9" height="9" />
      ) : (
        <path d="m2.5 2.5 9 9m0-9-9 9" />
      )}
    </svg>
  )
}
