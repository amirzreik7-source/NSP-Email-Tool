import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

const LOSS_COMPETITORS = ['CertaPro', 'Manor Works', 'Five Star', 'Other Company', 'DIY', 'Deferred', 'Unknown'];
const LOSS_REASONS = ['Price', 'Timeline', 'Unresponsive', 'Quality Concern', 'Went with referral', 'Other'];
const WIN_FACTORS = ['Price', 'Reputation', 'Response Speed', 'Relationship', 'Quality', 'Referral', 'Other'];
const LEAD_SOURCES = ['Referral', 'Google', 'Email Campaign', 'Text', 'Drove By Job', 'Website', 'Yelp', 'Other'];

export default function Intelligence() {
  const [tab, setTab] = useState('log'); // log, map
  const [outcomes, setOutcomes] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [competitiveMap, setCompetitiveMap] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Log form
  const [logType, setLogType] = useState('win');
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactSearch, setContactSearch] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [winFactor, setWinFactor] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [priceDiff, setPriceDiff] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      const [c, o] = await Promise.all([
        getAllContacts(uid),
        getDocs(query(collection(db, 'winLossLog'), where('userId', '==', uid))),
      ]);
      setContacts(c);
      setOutcomes(o.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, []);

  const logOutcome = async () => {
    if (!selectedContact) return;
    const outcome = {
      userId: auth.currentUser.uid,
      contactId: selectedContact.id,
      contactName: `${selectedContact.firstName} ${selectedContact.lastName}`,
      city: selectedContact.address?.city || '',
      type: logType,
      competitor: logType === 'loss' ? competitor : '',
      reason: logType === 'loss' ? lossReason : winFactor,
      leadSource: logType === 'win' ? leadSource : '',
      priceDifference: priceDiff ? parseFloat(priceDiff) : 0,
      notes,
      jobValue: (selectedContact.jobHistory || []).reduce((s, j) => s + (j.jobValue || 0), 0),
      date: new Date().toISOString(),
    };
    await addDoc(collection(db, 'winLossLog'), outcome);
    setOutcomes(prev => [outcome, ...prev]);
    // Reset form
    setSelectedContact(null); setContactSearch(''); setCompetitor(''); setLossReason(''); setWinFactor(''); setLeadSource(''); setPriceDiff(''); setNotes('');
    alert(`${logType === 'win' ? 'Win' : 'Loss'} logged!`);
  };

  const runCompetitiveAnalysis = async () => {
    setAnalyzing(true);
    try {
      const wins = outcomes.filter(o => o.type === 'win');
      const losses = outcomes.filter(o => o.type === 'loss');
      const res = await fetch(`${API}/api/competitive/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wins, losses }),
      });
      setCompetitiveMap(await res.json());
    } catch(e) { alert('Analysis failed: ' + e.message); }
    setAnalyzing(false);
    setTab('map');
  };

  const filtered = contacts.filter(c => (c.firstName + ' ' + c.lastName).toLowerCase().includes(contactSearch.toLowerCase())).slice(0, 10);
  const wins = outcomes.filter(o => o.type === 'win').length;
  const losses = outcomes.filter(o => o.type === 'loss').length;
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-800">🧠 Intelligence</h1>
        <div className="flex gap-2">
          <button onClick={() => setTab('log')} className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'log' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Log</button>
          <button onClick={() => setTab('map')} className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'map' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Competitive Map</button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-xl font-bold text-green-700">{wins}</p><p className="text-xs text-green-500">Wins</p></div>
        <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xl font-bold text-red-700">{losses}</p><p className="text-xs text-red-500">Losses</p></div>
        <div className="bg-blue-50 rounded-lg p-3 text-center"><p className="text-xl font-bold text-blue-700">{winRate}%</p><p className="text-xs text-blue-500">Win Rate</p></div>
        <div className="bg-gray-50 rounded-lg p-3 text-center"><p className="text-xl font-bold text-gray-700">{outcomes.length}</p><p className="text-xs text-gray-500">Total</p></div>
      </div>

      <p className="text-xs text-gray-400 mb-4">Prediction confidence: {outcomes.length < 20 ? '⚠️ Low (need 20+ outcomes)' : outcomes.length < 50 ? '📊 Medium' : outcomes.length < 200 ? '📈 Good' : '🎯 High'} — {outcomes.length} outcomes logged</p>

      {tab === 'log' && (
        <div className="space-y-4">
          {/* Log Form */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="font-semibold text-gray-700">Log Outcome</h3>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setLogType('win')} className={`p-3 rounded-lg border text-center ${logType === 'win' ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                <p className="text-lg">🎉</p><p className="text-sm font-medium">Win</p>
              </button>
              <button onClick={() => setLogType('loss')} className={`p-3 rounded-lg border text-center ${logType === 'loss' ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}>
                <p className="text-lg">❌</p><p className="text-sm font-medium">Loss</p>
              </button>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Contact</label>
              <input type="text" value={contactSearch} onChange={e => { setContactSearch(e.target.value); setSelectedContact(null); }}
                placeholder="Search..." className="w-full border rounded-lg px-3 py-2 text-sm" />
              {contactSearch && !selectedContact && filtered.map(c => (
                <button key={c.id} onClick={() => { setSelectedContact(c); setContactSearch(`${c.firstName} ${c.lastName}`); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 border-b">{c.firstName} {c.lastName} — {c.address?.city || ''}</button>
              ))}
            </div>
            {logType === 'loss' && (
              <>
                <div><label className="block text-sm text-gray-700 mb-1">Lost to</label>
                  <select value={competitor} onChange={e => setCompetitor(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select...</option>{LOSS_COMPETITORS.map(c => <option key={c}>{c}</option>)}
                  </select></div>
                <div><label className="block text-sm text-gray-700 mb-1">Reason</label>
                  <select value={lossReason} onChange={e => setLossReason(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select...</option>{LOSS_REASONS.map(r => <option key={r}>{r}</option>)}
                  </select></div>
                <div><label className="block text-sm text-gray-700 mb-1">Price difference ($)</label>
                  <input type="number" value={priceDiff} onChange={e => setPriceDiff(e.target.value)} placeholder="e.g., 800" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </>
            )}
            {logType === 'win' && (
              <>
                <div><label className="block text-sm text-gray-700 mb-1">Deciding factor</label>
                  <select value={winFactor} onChange={e => setWinFactor(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select...</option>{WIN_FACTORS.map(f => <option key={f}>{f}</option>)}
                  </select></div>
                <div><label className="block text-sm text-gray-700 mb-1">How they found us</label>
                  <select value={leadSource} onChange={e => setLeadSource(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">Select...</option>{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}
                  </select></div>
              </>
            )}
            <div><label className="block text-sm text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Any details..." /></div>
            <button onClick={logOutcome} disabled={!selectedContact} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Log {logType === 'win' ? 'Win' : 'Loss'}</button>
          </div>

          {outcomes.length >= 5 && (
            <button onClick={runCompetitiveAnalysis} disabled={analyzing} className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
              {analyzing ? '⏳ Analyzing...' : '🧠 Generate Competitive Map'}
            </button>
          )}

          {/* Recent outcomes */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 mb-3">Recent Outcomes</h3>
            {outcomes.length === 0 ? <p className="text-gray-400 text-sm">No outcomes logged yet.</p> : (
              <div className="space-y-2">
                {outcomes.slice(0, 20).map((o, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50">
                    <div>
                      <p className="text-sm font-medium">{o.contactName} — {o.city}</p>
                      <p className="text-xs text-gray-500">{o.type === 'loss' ? `Lost to ${o.competitor}: ${o.reason}` : `Won: ${o.reason}`} {o.leadSource ? `(${o.leadSource})` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${o.type === 'win' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{o.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'map' && competitiveMap && (
        <div className="space-y-4">
          {competitiveMap.insights?.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <h3 className="font-semibold text-purple-800 mb-2">🧠 AI Insights</h3>
              {competitiveMap.insights.map((insight, i) => <p key={i} className="text-sm text-purple-700 mb-1">• {insight}</p>)}
            </div>
          )}
          {competitiveMap.winRateByCity && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-3">Win Rate by City</h3>
              {Object.entries(competitiveMap.winRateByCity).sort((a, b) => b[1] - a[1]).map(([city, rate]) => (
                <div key={city} className="flex items-center gap-3 mb-2">
                  <span className="w-24 text-sm">{city}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4"><div className="bg-green-500 h-4 rounded-full" style={{ width: `${rate * 100}%` }} /></div>
                  <span className="text-sm font-medium w-12 text-right">{Math.round(rate * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          {competitiveMap.campaignRecommendations?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-3">Campaign Recommendations</h3>
              {competitiveMap.campaignRecommendations.map((rec, i) => (
                <div key={i} className="bg-blue-50 rounded-lg p-3 mb-2">
                  <p className="font-medium text-gray-800 text-sm">{rec.city}</p>
                  <p className="text-sm text-gray-600">{rec.angle}</p>
                  <p className="text-xs text-gray-400">{rec.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'map' && !competitiveMap && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">Log at least 5 outcomes, then click "Generate Competitive Map" on the Log tab.</p>
        </div>
      )}
    </div>
  );
}
