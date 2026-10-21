import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TrayMenuApp } from '@/features/tray/tray-menu'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrayMenuApp />
  </StrictMode>,
)
