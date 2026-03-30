import { useState, useEffect, useMemo } from 'react';
import { auth, db } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';
import { collection, updateDoc, doc } from 'firebase/firestore';

const STAGES = [
  { id: 'cold', label: 'Cold Contact', color: 'bg-gray-100 text-gray-600', icon: '❄️' },
  { id: 'contacted', label: 'Contacted', color: 'bg-blue-100 text-blue-700', icon: '📧' },
  { id: 'engaged', label: 'Engaged', color: 'bg-cyan-100 text-cyan-700', icon: '👀' },
  { id: 'estimate_requested', label: 'Estimate Requested', color: 'bg-yellow-100 text-yellow-700', icon: '📋' },
  { id: 'appointment', label: 'Appointment', color: 'bg-orange-100 text-orange-700', icon: '📅' },
  { id: 'estimated', label: 'Estimated', color: 'bg-amber-100 text-amber-700', icon: '💰' },
  { id: 'proposal_sent', label: 'Proposal Sent', color: 'bg-purple-100 text-purple-700', icon: '📄' },
  { id: 'won', label: 'Won', color: 'bg-green-100 text-green-700', icon: '🎉' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-emerald-100 text-emerald-700', icon: '🎨' },
  { id: 'completed', label: 'Completed', color: 'bg-teal-100 text-teal-700', icon: '✅' },
  { id: 'repeat', label: 'Repeat Customer', color: 'bg-indigo-100 text-indigo-700', icon: '🔄' },
];

export default function Pipeline() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('kanban'); // kanban or funnel

  useEffect(() => {
    (async () => {
      const data = await getAllContacts(auth.currentUser.uid);
      setContacts(data);
      setLoading(false);
    })();
  }, []);

  const stageData = useMemo(() => {
    return STAGES.map(stage => {
      const inStage = contacts.filter(c => {
        const s = c.currentStage || 'cold';
        if (s === stage.id) return true;
        // Auto-detect stage from data
        if (stage.id === 'cold' && !s && !(c.engagement?.campaignsReceived > 0)) return true;
        if (stage.id === 'contacted' && !s && c.engagement?.campaignsReceived > 0 && !c.engagement?.totalOpens) return true;
        if (stage.id === 'engaged' && !s && c.engagement?.totalOpens > 0) return true;
        return false;
      });
      const value = inStage.reduce((sum, c) => sum + ((c.jobHistory || []).reduce((s, j) => s + (j.jobValue || 0), 0)), 0);
      return { ...stage, contacts: inStage, count: inStage.length, value };
    });
  }, [contacts]);

  const moveContact = async (contactId, newStage) => {
    await updateDoc(doc(db, 'emailContacts', contactId), { currentStage: newStage, updatedAt: new Date().toISOString() });
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, currentStage: newStage } : c));
  };

  // Bottleneck detection
  const bottlenecks = stageData.filter(s => s.count > 10 && ['proposal_sent', 'estimated', 'estimate_requested'].includes(s.id));

  if (loading) return <p className="text-gray-400 text-center py-10">Loading pipeline...</p>;

  const totalContacted = contacts.filter(c => c.engagement?.campaignsReceived > 0).length;
  const totalEngaged = contacts.filter(c => c.engagement?.totalOpens > 0).length;
  const totalWon = contacts.filter(c => c.currentStage === 'won' || c.currentStage === 'completed').length;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🗺️ Pipeline</h1>
          <p className="text-sm text-gray-500">{contacts.length} total contacts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setView('kanban')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Kanban</button>
          <button onClick={() => setView('funnel')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'funnel' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Funnel</button>
        </div>
      </div>

      {bottlenecks.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-sm font-medium text-red-800">⚠️ Bottleneck detected</p>
          {bottlenecks.map(b => <p key={b.id} className="text-sm text-red-600">{b.count} contacts stuck in "{b.label}" — consider follow-up</p>)}
        </div>
      )}

      {view === 'funnel' ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="font-semibold text-gray-700 mb-3">Conversion Funnel</h3>
          {stageData.filter(s => s.count > 0).map((stage, i, arr) => {
            const prevCount = i > 0 ? arr[i-1].count : contacts.length;
            const convRate = prevCount > 0 ? ((stage.count / prevCount) * 100).toFixed(1) : '—';
            return (
              <div key={stage.id} className="flex items-center gap-3">
                <div className="w-32 text-sm text-gray-700 font-medium">{stage.icon} {stage.label}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
                  <div className={`h-6 rounded-full ${stage.color.split(' ')[0]}`} style={{ width: `${Math.max(5, (stage.count / Math.max(1, contacts.length)) * 100)}%` }} />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">{stage.count}</span>
                </div>
                <span className="w-16 text-xs text-gray-400 text-right">{i > 0 ? `${convRate}%` : ''}</span>
              </div>
            );
          })}
          <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-lg font-bold text-gray-800">{totalContacted}</p><p className="text-xs text-gray-500">Contacted</p></div>
            <div><p className="text-lg font-bold text-gray-800">{totalEngaged}</p><p className="text-xs text-gray-500">Engaged</p></div>
            <div><p className="text-lg font-bold text-green-600">{totalWon}</p><p className="text-xs text-gray-500">Won</p></div>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stageData.map(stage => (
            <div key={stage.id} className="min-w-48 max-w-56 flex-shrink-0">
              <div className={`rounded-lg p-2 mb-2 text-center ${stage.color}`}>
                <p className="text-sm font-medium">{stage.icon} {stage.label}</p>
                <p className="text-xs">{stage.count} · ${stage.value.toLocaleString()}</p>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {stage.contacts.slice(0, 15).map(c => (
                  <div key={c.id} className="bg-white rounded-lg border border-gray-200 p-2 text-xs">
                    <p className="font-medium text-gray-800 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-gray-400 truncate">{c.address?.city || ''}</p>
                  </div>
                ))}
                {stage.count > 15 && <p className="text-xs text-gray-400 text-center">+{stage.count - 15} more</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
