import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists } from '../lib/contacts';
import { getAllCampaigns } from '../lib/campaigns';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function Home() {
  const [lists, setLists] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [weather, setWeather] = useState([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [newGoal, setNewGoal] = useState({ description: '', targetCount: '' });
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) { setLoading(false); return; }

      const fetchWithTimeout = (url, ms = 5000) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { signal: ctrl.signal })
          .then(r => r.json())
          .finally(() => clearTimeout(timer));
      };

      const [allLists, allCampaigns, objRes, ctxRes] = await Promise.all([
        getAllLists(uid).catch(() => []),
        getAllCampaigns(uid).catch(() => []),
        fetchWithTimeout(`${API}/api/objectives?userId=${uid}`).catch(() => []),
        fetchWithTimeout(`${API}/api/strategy/context?userId=${uid}`, 6000).catch(() => ({})),
      ]);
      setLists(allLists || []);
      setCampaigns(allCampaigns || []);
      setObjectives(Array.isArray(objRes) ? objRes : []);
      setTotalContacts(ctxRes?.totalContacts || 0);
      setWeather((ctxRes?.weather || []).filter(w => w.isPaintingWeather));
    } finally {
      setLoading(false);
    }
  };

  const getListStats = (list) => {
    const lc = campaigns.filter(c => c.listId === list.id && c.sentAt).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const last = lc[0];
    const daysSince = last?.sentAt ? Math.floor((Date.now() - new Date(last.sentAt).getTime()) / (1000*60*60*24)) : null;
    const openRate = last?.stats?.sent ? Math.round((last.stats.opened || 0) / last.stats.sent * 100) : null;
    return { daysSince, openRate, totalCampaigns: lc.length };
  };

  const sentCampaigns = campaigns.filter(c => c.sentAt);
  const avgOpen = sentCampaigns.filter(c => c.stats?.sent).length > 0
    ? Math.round(sentCampaigns.filter(c => c.stats?.sent).reduce((s, c) => s + (c.stats.opened || 0), 0) / sentCampaigns.filter(c => c.stats?.sent).reduce((s, c) => s + c.stats.sent, 0) * 100)
    : 0;

  const addGoal = async () => {
    if (!newGoal.description.trim()) return;
    try {
      const res = await fetch(`${API}/api/objectives`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: auth.currentUser.uid, description: newGoal.description, targetCount: parseInt(newGoal.targetCount) || 0 }),
      });
      const data = await res.json();
      setObjectives([...objectives, data]);
      setNewGoal({ description: '', targetCount: '' });
      setShowGoalEditor(false);
    } catch (e) {}
  };

  const deleteGoal = async (id) => {
    try { await fetch(`${API}/api/objectives/${id}`, { method: 'DELETE' }); setObjectives(objectives.filter(o => o.id !== id)); } catch (e) {}
  };

  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="text-center"><p className="text-3xl">⭐</p><p className="text-gray-400 mt-2 text-sm">Loading...</p></div></div>;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{greeting()}, Amir</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <button onClick={() => navigate('/campaign/new')} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition">
          + New Campaign
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{totalContacts.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Contacts</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{sentCampaigns.length}</p>
          <p className="text-xs text-gray-500">Campaigns</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{avgOpen}%</p>
          <p className="text-xs text-gray-500">Avg Open Rate</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{lists.length}</p>
          <p className="text-xs text-gray-500">Lists</p>
        </div>
      </div>

      {/* Weather Alert */}
      {weather.length > 0 && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-cyan-800">🌤️ Perfect Painting Weather</h2>
              <p className="text-sm text-cyan-700 mt-1">{weather.map(w => `${w.city}: ${w.perfectDays}d · ${w.tempRange}`).join(' | ')}</p>
            </div>
            <button onClick={() => navigate('/campaign/new')} className="text-sm font-medium text-cyan-700 bg-white border border-cyan-300 px-3 py-1.5 rounded-lg hover:bg-cyan-50">Launch Campaign</button>
          </div>
        </div>
      )}

      {/* Season Goals */}
      {(objectives.length > 0 || showGoalEditor) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Season Goals</h2>
            <button onClick={() => setShowGoalEditor(!showGoalEditor)} className="text-xs text-blue-600">{showGoalEditor ? 'Cancel' : '+ Add'}</button>
          </div>
          {showGoalEditor && (
            <div className="bg-white rounded-xl border border-gray-200 p-3 mb-3 flex gap-2">
              <input type="text" value={newGoal.description} onChange={e => setNewGoal({ ...newGoal, description: e.target.value })} placeholder="Goal" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={newGoal.targetCount} onChange={e => setNewGoal({ ...newGoal, targetCount: e.target.value })} placeholder="Target #" className="w-24 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={addGoal} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {objectives.map(obj => {
              const pct = obj.targetCount ? Math.round((obj.currentProgress || 0) / obj.targetCount * 100) : 0;
              return (
                <div key={obj.id} className="bg-white rounded-xl border border-gray-200 p-3 group">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-gray-800">{obj.description}</p>
                    <button onClick={() => deleteGoal(obj.id)} className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">x</button>
                  </div>
                  {obj.targetCount > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      <span className="text-xs text-gray-500">{obj.currentProgress || 0}/{obj.targetCount}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your Lists */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Your Lists</h2>
        <button onClick={() => navigate('/contacts')} className="text-xs text-blue-600">Manage →</button>
      </div>

      {lists.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-gray-500 text-sm">No lists yet. Upload your first CSV.</p>
          <button onClick={() => navigate('/contacts')} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Upload CSV →</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {lists.map(list => {
            const stats = getListStats(list);
            const tierColor = list.tier === 'personal' ? 'border-l-purple-500' : list.tier === 'realtime' ? 'border-l-green-500' : 'border-l-blue-500';
            const isReady = stats.daysSince !== null && ((list.tier === 'personal' && stats.daysSince >= 14) || (list.tier !== 'personal' && stats.daysSince >= 21));

            return (
              <div key={list.id} onClick={() => navigate('/campaign/new', { state: { listId: list.id } })}
                className={`bg-white rounded-xl border border-gray-200 border-l-4 ${tierColor} p-4 cursor-pointer hover:shadow-md transition group`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">{list.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${list.tier === 'personal' ? 'bg-purple-100 text-purple-700' : list.tier === 'realtime' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{list.tier}</span>
                      {isReady && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ready to email</span>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {list.contactCount || 0} contacts
                      {stats.daysSince !== null && ` · Last emailed ${stats.daysSince}d ago`}
                      {stats.openRate !== null && ` · ${stats.openRate}% opened`}
                    </p>
                  </div>
                  <span className="text-gray-300 group-hover:text-blue-600 text-lg transition">→</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
