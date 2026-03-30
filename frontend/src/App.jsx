import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { auth, onAuthStateChanged } from './lib/firebase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Lists from './pages/Lists';
import Contacts from './pages/Contacts';
import Campaigns from './pages/Campaigns';
import Settings from './pages/Settings';
import ListDetail from './pages/ListDetail';
import HotLeads from './pages/HotLeads';
import Conversations from './pages/Conversations';
import FollowUps from './pages/FollowUps';
import ApprovalQueue from './pages/ApprovalQueue';
import AICampaign from './pages/AICampaign';
import AdExport from './pages/AdExport';
import Pipeline from './pages/Pipeline';
import WeatherTriggers from './pages/WeatherTriggers';
import Neighborhood from './pages/Neighborhood';
import Referrals from './pages/Referrals';
import VoiceLearning from './pages/VoiceLearning';
import Intelligence from './pages/Intelligence';

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
          <Route path="/" element={<Dashboard />} />
          <Route path="/hot-leads" element={<HotLeads />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/approval-queue" element={<ApprovalQueue />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:listId" element={<ListDetail />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/ai-campaign" element={<AICampaign />} />
          <Route path="/conversations" element={<Conversations />} />
          <Route path="/follow-ups" element={<FollowUps />} />
          <Route path="/neighborhood" element={<Neighborhood />} />
          <Route path="/weather" element={<WeatherTriggers />} />
          <Route path="/intelligence" element={<Intelligence />} />
          <Route path="/referrals" element={<Referrals />} />
          <Route path="/voice" element={<VoiceLearning />} />
          <Route path="/ad-export" element={<AdExport />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
