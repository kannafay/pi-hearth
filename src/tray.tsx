import { createRoot } from 'react-dom/client'
import { TrayMenuApp } from '@/features/tray/tray-menu'
import '@/index.css'

createRoot(document.getElementById('root')!).render(<TrayMenuApp />)
