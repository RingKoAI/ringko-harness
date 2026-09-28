import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Layout } from '@/layout/Layout'
import { ChatPage } from '@/pages/ChatPage'
import { LoginPage } from '@/pages/LoginPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AppProvider } from '@/store'

export default function App() {
  return (
    <TooltipProvider>
      <BrowserRouter>
        <AppProvider>
          <Routes>
            <Route path="/auth/login" element={<LoginPage />} />
            <Route element={<Layout />}>
              <Route index element={<ChatPage />} />
              <Route path=":id" element={<ChatPage />} />
              <Route path="settings" element={<Navigate to="/settings/general" replace />} />
              <Route path="settings/:page" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </AppProvider>
      </BrowserRouter>
    </TooltipProvider>
  )
}
