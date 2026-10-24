import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Layer = { id: string; priority: number }
type Layers = { layers: Layer[]; register: (layer: Layer) => () => void }
const DialogLayersContext = createContext<Layers | null>(null)

export function DialogLayerProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<Layer[]>([])
  const register = useCallback((layer: Layer) => {
    setLayers((current) => [...current, layer].sort((a, b) => a.priority - b.priority))
    return () => setLayers((current) => current.filter((item) => item.id !== layer.id))
  }, [])
  const value = useMemo(() => ({ layers, register }), [layers, register])
  return <DialogLayersContext value={value}>{children}</DialogLayersContext>
}

export function useDialogLayers() {
  return useContext(DialogLayersContext)
}
