import { useState, useEffect, useRef } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists, getContactsByList, getUnsubscribes } from '../lib/contacts';
import { getAllCampaigns } from '../lib/campaigns';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function StrategyHub() {
  const [mode, setMode] = useState('overview'); // 'overview' or 'campaign'
  const [lists, setLists] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [objectives, setObjectives] = useState([]);
  const [situation, setSituation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [newGoal, setNewGoal] = useState({ description: '', targetCount: '' });

  // Campaign conversation state
  const [selectedList, setSelectedList] = useState(null);
  const [listContacts, setListContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [readyToGenerate, setReadyToGenerate] = useState(false);

  const chatEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { loadOverview(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadOverview = async () => {
    const uid = auth.currentUser.uid;
    const [allLists, allCampaigns, objRes, ctxRes] = await Promise.all([
      getAllLists(uid),
      getAllCampaigns(uid),
      fetch(`${API}/api/objectives?userId=${uid}`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/strategy/context?userId=${uid}`).then(r => r.json()).catch(() => ({})),
    ]);
    setLists(allLists);
    setCampaigns(allCampaigns);
    setObjectives(objRes);
    setSituation(ctxRes);
    setLoading(false);
  };

  // ── Start campaign for a specific list ──
  const startListCampaign = async (list) => {
    setSelectedList(list);
    setMode('campaign');
    setChatLoading(true);
    setMessages([]);
    setReadyToGenerate(false);

    const uid = auth.currentUser.uid;
    const contacts = await getContactsByList(uid, list.id);
    const unsubs = await getUnsubscribes(uid);
    const filtered = contacts.filter(c => !c.unsubscribed && !c.bounced && !unsubs.has(c.email));
    setListContacts(filtered);

    // Get conversation ID
    const convRes = await fetch(`${API}/api/strategy/new`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    }).then(r => r.json()).catch(() => ({ conversationId: 'local_' + Date.now() }));
    setConversationId(convRes.conversationId);

    // Get list-specific campaigns
    const listCampaigns = campaigns
      .filter(c => c.listId === list.id && c.sentAt)
      .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

    const lastCampaign = listCampaigns[0];
    const daysSince = lastCampaign?.sentAt ? Math.floor((Date.now() - new Date(lastCampaign.sentAt).getTime()) / (1000*60*60*24)) : null;

    // Build rich context for AI
    const cities = [...new Set(filtered.map(c => c.address?.city).filter(Boolean))];
    const currentYear = new Date().getFullYear();
    const repaintCount = filtered.filter(c => {
      const job = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
      if (!job?.jobDate) return false;
      const years = currentYear - new Date(job.jobDate).getFullYear();
      return years >= 4 && years <= 8;
    }).length;

    const openRate = lastCampaign?.stats?.sent ? Math.round((lastCampaign.stats.opened || 0) / lastCampaign.stats.sent * 100) : null;

    // Initial AI message with full list context
    const initPrompt = `I want to create a campaign for my "${list.name}" list. Here's what you should know:
- ${filtered.length} active contacts (${list.tier} tier)
- Cities: ${cities.slice(0, 5).join(', ')}
- ${repaintCount} contacts in the 5-7 year repaint window
${lastCampaign ? `- Last campaign: "${lastCampaign.name}" sent ${daysSince} days ago, ${openRate}% open rate` : '- No previous campaigns to this list'}
${list.userContext ? `- Context: ${list.userContext}` : ''}
${listCampaigns.length > 1 ? `- ${listCampaigns.length} total campaigns sent to this list` : ''}

Give me your recommendation — what should we send, who to target, subject line options with reasoning.`;

    try {
      const res = await fetch(`${API}/api/strategy/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: uid, conversationId: convRes.conversationId,
          messages: [{ role: 'user', content: initPrompt }],
        }),
      });
      const data = await res.json();
      setMessages([
        { role: 'user', content: `Campaign for: ${list.name}`, hidden: true },
        { role: 'assistant', content: data.response || "I'm analyzing your list data. Tell me what you're thinking for this campaign." },
      ]);
    } catch (e) {
      setMessages([{ role: 'assistant', content: `Looking at your ${list.name} list — ${filtered.length} contacts, ${cities.slice(0, 3).join(', ')}. What's the goal for this campaign?` }]);
    }
    setChatLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || chatLoading) return;
    const uid = auth.currentUser.uid;
    const userMessage = input.trim();
    setInput('');

    const visibleMessages = messages.filter(m => !m.hidden);
    const newMessages = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setChatLoading(true);

    try {
      const apiMessages = newMessages.filter(m => !m.hidden).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(`${API}/api/strategy/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, conversationId, messages: apiMessages }),
      });
      const data = await res.json();
      if (data.response) {
        setMessages([...newMessages, { role: 'assistant', content: data.response }]);
        const lower = data.response.toLowerCase();
        if (lower.includes('generate') || lower.includes('build this') || lower.includes('ready to send') || lower.includes("let's do it") || lower.includes('approve')) {
          setReadyToGenerate(true);
        }
      }
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: 'Having trouble connecting. Try again.' }]);
    }
    setChatLoading(false);
  };

  const launchCampaignFlow = () => {
    // Extract content direction from the conversation
    const convo = messages.filter(m => !m.hidden).map(m => `${m.role === 'user' ? 'Amir' : 'AI'}: ${m.content}`).join('\n');
    navigate('/campaign-flow/new', { state: { strategyContext: convo, listId: selectedList?.id } });
  };

  const addObjective = async () => {
    if (!newGoal.description.trim()) return;
    const uid = auth.currentUser.uid;
    try {
      const res = await fetch(`${API}/api/objectives`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, description: newGoal.description, targetCount: parseInt(newGoal.targetCount) || 0 }),
      });
      const data = await res.json();
      setObjectives([...objectives, data]);
      setNewGoal({ description: '', targetCount: '' });
      setShowGoalEditor(false);
    } catch (e) {}
  };

  const deleteObjective = async (id) => {
    try { await fetch(`${API}/api/objectives/${id}`, { method: 'DELETE' }); setObjectives(objectives.filter(o => o.id !== id)); } catch (e) {}
  };

  const getListStats = (list) => {
    const listCampaigns = campaigns.filter(c => c.listId === list.id && c.sentAt).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    const last = listCampaigns[0];
    const daysSince = last?.sentAt ? Math.floor((Date.now() - new Date(last.sentAt).getTime()) / (1000*60*60*24)) : null;
    const openRate = last?.stats?.sent ? Math.round((last.stats.opened || 0) / last.stats.sent * 100) : null;
    return { lastCampaign: last, daysSince, openRate, totalCampaigns: listCampaigns.length };
  };

  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center"><p className="text-3xl">⭐</p><p className="text-gray-400 mt-2 text-sm">Loading...</p></div>
    </div>
  );

  // ══════════════════════════════════════
  // CAMPAIGN CONVERSATION MODE
  // ══════════════════════════════════════
  if (mode === 'campaign' && selectedList) return (
    <div className="flex gap-6 h-[calc(100vh-48px)] -m-6">
      {/* Left Panel — List Context */}
      <div className="w-64 shrink-0 bg-white border-r border-gray-200 p-4 overflow-y-auto">
        <button onClick={() => { setMode('overview'); setSelectedList(null); setMessages([]); }}
          className="text-xs text-gray-500 hover:text-gray-700 mb-3">← Back to Overview</button>

        <div className="mb-4">
          <h3 className="text-sm font-bold text-gray-800">{selectedList.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${selectedList.tier === 'personal' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {selectedList.tier}
          </span>
        </div>

        <div className="space-y-3 text-xs">
          <div className="flex items-center gap-2">
            <span>👥</span>
            <div><p className="font-medium text-gray-700">{listContacts.length} contacts</p></div>
          </div>

          {(() => {
            const stats = getListStats(selectedList);
            return stats.lastCampaign ? (
              <div className="flex items-center gap-2">
                <span>📧</span>
                <div>
                  <p className="font-medium text-gray-700">Last: {stats.daysSince}d ago</p>
                  <p className="text-gray-400">{stats.openRate}% opened · {stats.totalCampaigns} total</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span>📧</span><p className="text-gray-400">No campaigns yet</p>
              </div>
            );
          })()}

          {situation?.weather?.filter(w => w.isPaintingWeather).slice(0, 2).map(w => (
            <div key={w.city} className="flex items-center gap-2">
              <span>🌤️</span>
              <div><p className="font-medium text-gray-700">{w.city}</p><p className="text-gray-400">{w.perfectDays}d perfect · {w.tempRange}</p></div>
            </div>
          ))}
        </div>

        {selectedList.userContext && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">{selectedList.userContext}</p>
          </div>
        )}
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="pb-3 border-b border-gray-100 px-2">
          <h1 className="text-lg font-bold text-gray-800">Campaign: {selectedList.name}</h1>
          <p className="text-xs text-gray-400">Strategy → Content → Design — all in one conversation</p>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-2 space-y-4">
          {messages.filter(m => !m.hidden).map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
              }`}>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {readyToGenerate && (
          <div className="mx-2 mb-2">
            <button onClick={launchCampaignFlow}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition">
              ✓ Build Campaign → Generate Emails for {listContacts.length} Contacts
            </button>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 px-2 pb-2">
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Discuss strategy, subject lines, content direction..."
              className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400"
              disabled={chatLoading} />
            <button onClick={sendMessage} disabled={!input.trim() || chatLoading}
              className="px-5 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm disabled:opacity-50 hover:bg-blue-700 transition">Send</button>
          </div>
          {!readyToGenerate && messages.length > 2 && (
            <button onClick={launchCampaignFlow} className="w-full text-gray-400 hover:text-blue-600 py-2 text-xs mt-1 transition">
              Skip ahead → Go to campaign builder
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════
  // OVERVIEW MODE (HOME SCREEN)
  // ══════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{greeting()}, Amir</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{lists.length}</p>
          <p className="text-xs text-gray-500">Lists</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{situation?.totalContacts || 0}</p>
          <p className="text-xs text-gray-500">Contacts</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{campaigns.filter(c => c.sentAt).length}</p>
          <p className="text-xs text-gray-500">Campaigns Sent</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-600">
            {campaigns.filter(c => c.stats?.sent).length > 0
              ? Math.round(campaigns.filter(c => c.stats?.sent).reduce((sum, c) => sum + (c.stats.opened || 0), 0) / campaigns.filter(c => c.stats?.sent).reduce((sum, c) => sum + c.stats.sent, 0) * 100) || 0
              : 0}%
          </p>
          <p className="text-xs text-gray-500">Avg Open Rate</p>
        </div>
      </div>

      {/* Goals */}
      {(objectives.length > 0 || showGoalEditor) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Season Goals</h2>
            <button onClick={() => setShowGoalEditor(!showGoalEditor)} className="text-xs text-blue-600">{showGoalEditor ? 'Cancel' : '+ Add Goal'}</button>
          </div>
          {showGoalEditor && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3 flex gap-2">
              <input type="text" value={newGoal.description} onChange={e => setNewGoal({ ...newGoal, description: e.target.value })}
                placeholder="Goal description" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
              <input type="number" value={newGoal.targetCount} onChange={e => setNewGoal({ ...newGoal, targetCount: e.target.value })}
                placeholder="Target #" className="w-24 border rounded-lg px-3 py-2 text-sm" />
              <button onClick={addObjective} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {objectives.map(obj => {
              const pct = obj.targetCount ? Math.round((obj.currentProgress || 0) / obj.targetCount * 100) : 0;
              return (
                <div key={obj.id} className="bg-white rounded-xl border border-gray-200 p-4 group">
                  <div className="flex items-start justify-between">
                    <p className="text-sm font-medium text-gray-800">{obj.description}</p>
                    <button onClick={() => deleteObjective(obj.id)} className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">x</button>
                  </div>
                  {obj.targetCount > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2"><div className="bg-blue-600 h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                        <span className="text-xs text-gray-500 font-medium">{obj.currentProgress || 0}/{obj.targetCount}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weather Alerts */}
      {situation?.weather?.filter(w => w.isPaintingWeather).length > 0 && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 mb-6">
          <h2 className="text-sm font-bold text-cyan-800 mb-2">🌤️ Perfect Painting Weather</h2>
          <div className="flex gap-4">
            {situation.weather.filter(w => w.isPaintingWeather).map(w => (
              <span key={w.city} className="text-sm text-cyan-700">{w.city}: {w.perfectDays}d · {w.tempRange}</span>
            ))}
          </div>
        </div>
      )}

      {/* Lists — Campaign Launch Cards */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Your Lists — Click to Start Campaign</h2>
        <button onClick={() => navigate('/contacts')} className="text-xs text-blue-600">Manage Lists →</button>
      </div>

      {lists.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-gray-500 text-sm">No lists yet. Upload your first CSV to get started.</p>
          <button onClick={() => navigate('/contacts')} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Upload CSV →</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {lists.map(list => {
            const stats = getListStats(list);
            const tierColor = list.tier === 'personal' ? 'border-l-purple-500' : list.tier === 'realtime' ? 'border-l-green-500' : 'border-l-blue-500';
            const isStale = stats.daysSince !== null && (
              (list.tier === 'personal' && stats.daysSince >= 14) ||
              (list.tier !== 'personal' && stats.daysSince >= 21)
            );

            return (
              <div key={list.id} onClick={() => startListCampaign(list)}
                className={`bg-white rounded-xl border border-gray-200 border-l-4 ${tierColor} p-5 cursor-pointer hover:shadow-md transition group`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">{list.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        list.tier === 'personal' ? 'bg-purple-100 text-purple-700' :
                        list.tier === 'realtime' ? 'bg-green-100 text-green-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>{list.tier}</span>
                      {isStale && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Ready to email</span>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {list.contactCount || 0} contacts
                      {stats.daysSince !== null && ` · Last emailed ${stats.daysSince}d ago`}
                      {stats.openRate !== null && ` · ${stats.openRate}% opened`}
                    </p>
                    {list.userContext && <p className="text-xs text-gray-400 mt-1 line-clamp-1">{list.userContext}</p>}
                  </div>
                  <span className="text-gray-300 group-hover:text-blue-600 text-lg transition">→</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick action */}
      <div className="mt-6 text-center">
        <button onClick={() => navigate('/campaign-flow/new')}
          className="text-sm text-gray-400 hover:text-blue-600 transition">
          Or skip strategy — build campaign directly →
        </button>
      </div>
    </div>
  );
}
