import { Routes, Route } from 'react-router-dom'
import { ChatProvider } from './context/ChatContext'
import { ThemeProvider } from './context/ThemeContext'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { ToneLab } from './pages/ToneLab'
import { CommitmentsPage } from './pages/Commitments'
import { PsychologyPage } from './pages/Psychology'
import { SchedulePage } from './pages/Schedule'
import { ChatPage } from './pages/Chat'
import { WhatsAppViewer } from './pages/WhatsAppViewer'
import LiveChat from './pages/LiveChat'
import { SettingsPage } from './pages/Settings'
import { AutoReplyPage } from './pages/AutoReply'
import { TestRunPage } from './pages/TestRun'
import { KeyboardCompanion } from './pages/KeyboardCompanion'

export default function App() {
  return (
    <ThemeProvider>
    <ChatProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/keyboard" element={<KeyboardCompanion />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/viewer" element={<WhatsAppViewer />} />
          <Route path="/commitments" element={<CommitmentsPage />} />
          <Route path="/tone" element={<ToneLab />} />
          <Route path="/psychology" element={<PsychologyPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/live" element={<LiveChat />} />
          <Route path="/auto-reply" element={<AutoReplyPage />} />
          <Route path="/test-run"   element={<TestRunPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </ChatProvider>
    </ThemeProvider>
  )
}
