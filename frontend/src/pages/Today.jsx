import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function Today() {
  const [loading, setLoading] = useState(true);
  const [sneQueue, setSneQueue] = useState([]);
  const [approvalItems, setApprovalItems] = useState([]);
  const [hotLeads, setHotLeads] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [stats, setStats] = useState({ leadsToday: 0, sentYesterday: 0, responseRate: 0, pipelineValue: 0 });
  const [weatherAlert, setWeatherAlert] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;

      // Load all data in parallel
      const [allContacts, seqSnap, convoSnap, leadsSnap] = await Promise.all([
        getAllContacts(uid),
        getDocs(query(collection(db, 'followUpSequences'), where('userId', '==', uid), where('status', '==', 'active'))),
        getDocs(query(collection(db, 'textConversations'), where('userId', '==', uid))),
        getDocs(query(collection(db, 'leads'), where('userId', '==', uid))),
      ]);

      setContacts(allContacts);

      // Saturday Night Engine queue
      try {
        const sneRes = await fetch(`${API}/api/saturday-night/queue`);
        const sneData = await sneRes.json();
        setSneQueue((sneData || []).filter(i => i.status === 'pending'));
      } catch(e) {}

      // Approval queue — find due follow-up steps
      const sequences = seqSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const today = new Date();
      const pending = [];
      sequences.forEach(seq => {
        const startDate = new Date(seq.startDate);
        seq.steps.forEach((step, idx) => {
          if (step.completed) return;
          const dueDate = new Date(startDate);
          dueDate.setDate(dueDate.getDate() + step.day);
          if (dueDate <= today) {
            pending.push({ seqId: seq.id, stepIndex: idx, contactName: seq.contactName, channel: step.channel, goal: step.goal, day: step.day, templateName: seq.templateName });
          }
        });
      });
      setApprovalItems(pending);

      // Hot leads — contacts with high buying signals
      const hot = allContacts.map(c => {
        let score = 0;
        if (c.engagement?.totalOpens > 3) score += 20;
        if (c.engagement?.totalClicks > 0) score += 25;
        if (c.engagement?.engagementTrend === 'rising') score += 15;
        const recentJob = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
        if (recentJob?.jobDate) {
          const years = new Date().getFullYear() - new Date(recentJob.jobDate).getFullYear();
          if (years >= 5) score += 30;
          else if (years >= 4) score += 15;
        }
        if (c.intelligenceProfile?.personalNotes) score += 10;
        if ((c.lists || []).length > 1) score += 10;
        return { ...c, hotScore: score };
      }).filter(c => c.hotScore >= 40).sort((a, b) => b.hotScore - a.hotScore).slice(0, 5);
      setHotLeads(hot);

      // Unread conversations
      const convos = convoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const unread = convos.filter(c => {
        const msgs = c.messages || [];
        const lastMsg = msgs[msgs.length - 1];
        return lastMsg && lastMsg.from !== 'Amir';
      });
      setConversations(unread);

      // Stats
      const leads = leadsSnap.docs.map(d => d.data());
      const todayStr = new Date().toISOString().split('T')[0];
      const leadsToday = leads.filter(l => l.detectedDate?.startsWith(todayStr)).length;
      setStats({ leadsToday, sentYesterday: 0, responseRate: 8.3, pipelineValue: allContacts.reduce((s, c) => s + ((c.jobHistory || []).reduce((js, j) => js + (j.jobValue || 0), 0)), 0) });

      // Weather check
      try {
        const wRes = await fetch(`${API}/api/weather/check-cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cities: ['Vienna', 'Arlington', 'McLean'] }) });
        const wData = await wRes.json();
        if (wData.alerts?.length) setWeatherAlert(wData.alerts[0]);
      } catch(e) {}

      setLoading(false);
    })();
  }, []);

  const totalAttention = sneQueue.length + approvalItems.length + conversations.length + hotLeads.length;
  const allCaughtUp = totalAttention === 0;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <p className="text-3xl">⭐</p>
        <p className="text-gray-400 mt-2 text-sm">Loading your day...</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{greeting()}, Amir</h1>
        <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* All caught up state */}
      {allCaughtUp && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center mb-6">
          <p className="text-4xl mb-3">✅</p>
          <h2 className="text-xl font-bold text-green-800">You're all caught up!</h2>
          <p className="text-green-600 mt-2">No pending items. The system is working in the background finding leads.</p>
          <div className="flex gap-3 justify-center mt-4">
            <button onClick={() => navigate('/leads')} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Browse Leads</button>
            <button onClick={() => navigate('/campaigns')} className="bg-white text-green-700 border border-green-300 px-4 py-2 rounded-lg text-sm font-medium">New Campaign</button>
          </div>
        </div>
      )}

      {/* Saturday Night Engine — Website Leads */}
      {sneQueue.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide mb-2">🌙 Website Leads ({sneQueue.length})</h2>
          {sneQueue.map(item => (
            <div key={item.id} className="bg-red-50 border border-red-200 rounded-xl p-4 mb-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-gray-800">{item.firstName} {item.lastName}</p>
                  <p className="text-sm text-gray-500">{item.address} · {item.serviceType}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-red-600">{Math.max(0, Math.floor((new Date(item.autoSendTime) - new Date()) / 60000))}m</p>
                  <p className="text-xs text-red-400">auto-send</p>
                </div>
              </div>
              {item.aiResponse && (
                <p className="text-sm text-gray-600 bg-white rounded-lg p-2 mt-2">{item.aiResponse.text}</p>
              )}
              <div className="flex gap-2 mt-2">
                <button onClick={async () => { await fetch(`${API}/api/saturday-night/send/${item.id}`, { method: 'POST' }); setSneQueue(prev => prev.filter(i => i.id !== item.id)); }}
                  className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">Send Now</button>
                <button onClick={() => navigate('/saturday-night')} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approval Queue */}
      {approvalItems.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-orange-700 uppercase tracking-wide mb-2">✅ Approve ({approvalItems.length})</h2>
          {approvalItems.slice(0, 5).map((item, i) => (
            <div key={i} className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-2 flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-800 text-sm">{item.contactName}</p>
                <p className="text-xs text-gray-500">{item.templateName} · Day {item.day} · {item.channel === 'text' ? '💬' : '📧'}</p>
              </div>
              <button onClick={() => navigate('/conversations')} className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg">Review</button>
            </div>
          ))}
          {approvalItems.length > 5 && <button onClick={() => navigate('/conversations')} className="text-xs text-orange-600">+{approvalItems.length - 5} more →</button>}
        </div>
      )}

      {/* Unread Replies */}
      {conversations.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-blue-700 uppercase tracking-wide mb-2">💬 Replies ({conversations.length})</h2>
          {conversations.slice(0, 3).map(convo => (
            <div key={convo.id} onClick={() => navigate('/conversations')} className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 cursor-pointer hover:shadow-sm">
              <p className="font-medium text-gray-800 text-sm">{convo.contactName}</p>
              <p className="text-xs text-gray-500 truncate">{convo.lastMessage}</p>
            </div>
          ))}
        </div>
      )}

      {/* Hot Leads */}
      {hotLeads.length > 0 && !allCaughtUp && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-purple-700 uppercase tracking-wide mb-2">🔥 Hot Leads ({hotLeads.length})</h2>
          {hotLeads.slice(0, 3).map(lead => (
            <div key={lead.id} onClick={() => navigate('/leads')} className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-2 cursor-pointer hover:shadow-sm flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-800 text-sm">{lead.firstName} {lead.lastName}</p>
                <p className="text-xs text-gray-500">{lead.address?.city || ''} · {lead.email || lead.phone || 'Address only'}</p>
              </div>
              <span className="text-sm font-bold text-purple-700">{lead.hotScore}</span>
            </div>
          ))}
          <button onClick={() => navigate('/leads')} className="text-xs text-purple-600">View all leads →</button>
        </div>
      )}

      {/* Weather Alert */}
      {weatherAlert && (
        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 mb-4">
          <p className="text-sm font-medium text-cyan-800">🌤️ Perfect painting weather in {weatherAlert.city}</p>
          <p className="text-xs text-cyan-600">{weatherAlert.perfectDays} days · {weatherAlert.tempRange}</p>
          <button onClick={() => navigate('/campaigns')} className="text-xs text-cyan-700 font-medium mt-1">Launch Campaign →</button>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2 mt-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-lg font-bold text-gray-800">{stats.leadsToday}</p>
          <p className="text-xs text-gray-500">Leads today</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-lg font-bold text-gray-800">{contacts.length}</p>
          <p className="text-xs text-gray-500">Contacts</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-lg font-bold text-gray-800">{stats.responseRate}%</p>
          <p className="text-xs text-gray-500">Response rate</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-lg font-bold text-green-600">${Math.round(stats.pipelineValue / 1000)}K</p>
          <p className="text-xs text-gray-500">Pipeline</p>
        </div>
      </div>
    </div>
  );
}
