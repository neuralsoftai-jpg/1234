import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './components/Home';
import Chat from './components/Chat';
import OwnerLogin from './components/OwnerLogin';
import OwnerDashboard from './components/OwnerDashboard';

/**
 * Root router.
 * /           → Home screen (create / join / special access)
 * /chat       → Chat screen (normal 1-to-1 or special-access visitor)
 * /owner      → Hidden owner login page
 * /owner/dash → Owner dashboard (visitor list + chat)
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/owner" element={<OwnerLogin />} />
        <Route path="/owner/dash" element={<OwnerDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
