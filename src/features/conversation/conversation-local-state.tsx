import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react'

const LocalState = createContext<Map<string, unknown> | null>(null)

export function ConversationLocalState({
  children,
  initial,
}: {
  children: ReactNode
  initial?: Map<string, unknown>
}) {
  const [cache] = useState(() => initial ?? new Map<string, unknown>())
  return <LocalState.Provider value={cache}>{children}</LocalState.Provider>
}

// Preserve drafts and expanded process/tool details when virtual rows unmount.
export function useConversationLocalState<T>(key: string | undefined, initial: T) {
  const cache = useContext(LocalState)
  const [state, setState] = useState<T>(() =>
    key && cache?.has(key) ? (cache.get(key) as T) : initial,
  )
  const current = useRef(state)
  const update = useCallback(
    (value: SetStateAction<T>) => {
      const next =
        typeof value === 'function' ? (value as (previous: T) => T)(current.current) : value
      current.current = next
      if (key) cache?.set(key, next)
      setState(next)
    },
    [cache, key],
  )
  return [state, update] as const
}
