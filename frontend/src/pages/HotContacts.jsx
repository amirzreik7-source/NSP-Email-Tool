import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';
import { useNavigate } from 'react-router-dom';

export default function HotContacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [minScore, setMinScore] = useState(50);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const all = await getAllContacts(auth.currentUser.uid);
      const scored = all.map(c => {
        // Use stored Storm Score if available, otherwise calculate simplified score
        if (c.stormScore?.score) return { ...c, displayScore: c.stormScore.score, scoreSource: 'storm' };
        let score = 0;
        if (c.engagement?.totalOpens > 3) score += 20;
        if (c.engagement?.totalClicks > 0) score += 25;
        if (c.engagement?.engagementTrend === 'rising') score += 15;
        const job = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];
        if (job?.jobDate) {
          const years = new Date().getFullYear() - new Date(job.jobDate).getFullYear();
          if (years >= 5) score += 30;
          else if (years >= 4) score += 15;
        }
        if (c.intelligenceProfile?.personalNotes) score += 10;
        return { ...c, displayScore: score, scoreSource: 'calculated' };
      }).filter(c => c.displayScore >= minScore).sort((a, b) => b.displayScore - a.displayScore);
      setContacts(scored);
      setLoading(false);
    })();
  }, [minScore]);

  const scoreColor = (s) => s >= 80 ? 'text-red-600 bg-red-50' : s >= 60 ? 'text-orange-600 bg-orange-50' : s >= 40 ? 'text-yellow-600 bg-yellow-50' : 'text-gray-600 bg-gray-50';

  if (loading) return <p className="text-gray-400 text-center py-10">Loading hot contacts...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">Hot Contacts <span className="text-gray-400 text-lg font-normal">({contacts.length})</span></h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Min score:</label>
          <select value={minScore} onChange={e => setMinScore(parseInt(e.target.value))} className="border rounded-lg px-2 py-1 text-sm">
            <option value={40}>40+</option>
            <option value={50}>50+</option>
            <option value={60}>60+</option>
            <option value={70}>70+</option>
            <option value={80}>80+</option>
          </select>
        </div>
      </div>

      {contacts.length === 0 ? (
        <p className="text-gray-400 text-center py-10">No contacts above score {minScore}</p>
      ) : (
        <div className="space-y-2">
          {contacts.slice(0, 50).map(c => (
            <div key={c.id} onClick={() => navigate(`/contacts/profile/${c.id}`)} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:shadow-sm transition cursor-pointer">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800">{c.firstName} {c.lastName}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreColor(c.displayScore)}`}>{c.displayScore}</span>
                </div>
                <p className="text-sm text-gray-500">{c.address?.city || ''} · {c.email || 'No email'}</p>
                {c.stormScore?.breakdown && (
                  <p className="text-xs text-gray-400 mt-1">{Object.entries(c.stormScore.breakdown).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
                )}
              </div>
              <button onClick={(e) => { e.stopPropagation(); navigate('/campaign/new'); }} className="text-xs text-blue-600 hover:underline">Campaign →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
