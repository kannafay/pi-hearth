import type { DirectoryApplication } from '@/lib/desktop'

export function ApplicationIcon({ application }: { application: DirectoryApplication }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none">
      {application === 'vscode' ? (
        <>
          <path fill="#007ACC" d="m17.5 2 5 2v16l-5 2L6.3 12 17.5 2Zm0 5.4L11.8 12l5.7 4.6V7.4Z" />
          <path
            fill="#1F9CF0"
            d="m4.5 5-3 1.4v11.2l3 1.4L17.5 7.4V2L4.5 14.1V9.9L17.5 22v-5.4L4.5 5Z"
          />
        </>
      ) : application === 'explorer' ? (
        <>
          <path
            fill="#E6A625"
            d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"
          />
          <path fill="#FFD569" d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9Z" />
          <path fill="#70B5EC" d="M4 9h16v2H4z" />
          <path fill="#FFE8A6" d="M2 12h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" />
        </>
      ) : (
        <>
          <rect x="1" y="3" width="22" height="18" rx="3" fill="#34383F" />
          <path fill="#5EAAF0" d="M4 3h9l2 4H2V5a2 2 0 0 1 2-2Z" />
          <path fill="#22262B" d="M2 7h20v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z" />
          <path
            d="m6 10 3.5 3L6 16"
            stroke="#F4F7FA"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 16h5" stroke="#72D7BA" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
