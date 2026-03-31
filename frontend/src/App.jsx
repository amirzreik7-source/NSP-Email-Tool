import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { auth, onAuthStateChanged } from './lib/firebase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Today from './pages/Today';
import Leads from './pages/Leads';
import CampaignsHub from './pages/CampaignsHub';
import ContactsHub from './pages/ContactsHub';
import ConversationsHub from './pages/ConversationsHub';
import Reports from './pages/Reports';
import SettingsHub from './pages/SettingsHub';
import ListDetail from './pages/ListDetail';
import SaturdayNight from './pages/SaturdayNight';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
    return unsubscribe;
  }, []);

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><p className="text-3xl">⭐</p><p className="text-gray-400 mt-2 text-sm">Loading...</p></div></div>;
  if (!user) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Today />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/campaigns" element={<CampaignsHub />} />
          <Route path="/contacts" element={<ContactsHub />} />
          <Route path="/contacts/:listId" element={<ListDetail />} />
          <Route path="/conversations" element={<ConversationsHub />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsHub />} />
          <Route path="/saturday-night" element={<SaturdayNight />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
