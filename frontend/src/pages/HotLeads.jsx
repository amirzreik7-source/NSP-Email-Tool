import { useState, useEffect, useMemo } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';

export default function HotLeads() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await getAllContacts(auth.currentUser.uid);
      setContacts(data);
      setLoading(false);
    })();
  }, []);

  // Calculate hot lead score for each contact
  const hotLeads = useMemo(() => {
    return contacts.map(c => {
      let score = 0;
      let signals = [];

      // Engagement signals
      if (c.engagement?.totalOpens > 3) { score += 20; signals.push('Active opener'); }
      if (c.engagement?.totalClicks > 0) { score += 25; signals.push('Clicked links'); }
      if (c.engagement?.engagementTrend === 'rising') { score += 15; signals.push('Engagement rising'); }

      // Repaint cycle signals
      const recentJob = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
      if (recentJob?.jobDate) {
        const yearsSince = new Date().getFullYear() - new Date(recentJob.jobDate).getFullYear();
        if (recentJob.jobType === 'Exterior' && yearsSince >= 5) { score += 30; signals.push(`Exterior ${yearsSince}yr ago — repaint window`); }
        else if (recentJob.jobType === 'Interior' && yearsSince >= 7) { score += 25; signals.push(`Interior ${yearsSince}yr ago — due for refresh`); }
        else if (yearsSince >= 4) { score += 15; signals.push(`${yearsSince} years since last job`); }
      }

      // Has personal notes (field intelligence)
      if (c.intelligenceProfile?.personalNotes) { score += 10; signals.push('Has field notes'); }

      // Multiple lists (appeared in multiple sources)
      if ((c.lists || []).length > 1) { score += 10; signals.push('Multiple lists'); }

      // High job value
      if (recentJob?.jobValue > 5000) { score += 10; signals.push(`High value ($${recentJob.jobValue})`); }

      return { ...c, hotScore: score, signals, recentJob };
    })
    .filter(c => c.hotScore > 0)
    .sort((a, b) => b.hotScore - a.hotScore);
  }, [contacts]);

  if (loading) return <p className="text-gray-400 text-center py-10">Analyzing contacts...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🔥 Hot Leads</h1>
        <p className="text-sm text-gray-500 mt-1">{hotLeads.length} contacts showing buying signals</p>
      </div>

      {hotLeads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-500">No hot leads detected yet.</p>
          <p className="text-gray-400 text-sm mt-1">Upload contacts and send campaigns to start building engagement data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hotLeads.slice(0, 50).map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-800">{c.firstName} {c.lastName}</h3>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.hotScore >= 50 ? 'bg-red-100 text-red-700' : c.hotScore >= 30 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      🔥 {c.hotScore}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{c.email} · {c.address?.city || 'Unknown city'}</p>
                </div>
                <div className="text-right">
                  {c.recentJob && (
                    <p className="text-xs text-gray-500">{c.recentJob.jobType} · {c.recentJob.jobDate ? new Date(c.recentJob.jobDate).getFullYear() : ''}</p>
                  )}
                  {c.recentJob?.jobValue > 0 && (
                    <p className="text-sm font-medium text-green-600">${c.recentJob.jobValue.toLocaleString()}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {c.signals.map((s, i) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s}</span>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">📧 Email</button>
                <button className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700">💬 Text</button>
                <button className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700">🤖 AI Outreach</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
