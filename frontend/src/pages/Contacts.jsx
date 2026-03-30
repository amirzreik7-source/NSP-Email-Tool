import { useState, useEffect, useMemo } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await getAllContacts(auth.currentUser.uid);
      setContacts(data);
      setLoading(false);
    })();
  }, []);

  const cities = useMemo(() => [...new Set(contacts.map(c => c.address?.city).filter(Boolean))].sort(), [contacts]);
  const tiers = useMemo(() => [...new Set(contacts.flatMap(c => (c.lists || []).map(l => l.tier)).filter(Boolean))], [contacts]);

  const filtered = useMemo(() => {
    let result = contacts;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => (c.firstName + ' ' + c.lastName + ' ' + c.email).toLowerCase().includes(q));
    }
    if (cityFilter) result = result.filter(c => c.address?.city === cityFilter);
    if (tierFilter) result = result.filter(c => c.lists?.some(l => l.tier === tierFilter));
    return result;
  }, [contacts, search, cityFilter, tierFilter]);

  if (selected) return <ContactDetail contact={selected} onBack={() => setSelected(null)} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Contacts <span className="text-gray-400 text-lg font-normal">({contacts.length})</span></h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" placeholder="Search name or email..." value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48" />
        <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {loading ? <p className="text-gray-400 text-center py-10">Loading...</p> : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-gray-500">{contacts.length === 0 ? 'No contacts yet.' : 'No contacts match your filters.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">City</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Lists</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Score</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(c => (
                <tr key={c.id} onClick={() => setSelected(c)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.firstName} {c.lastName}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email}</td>
                  <td className="px-4 py-3 text-gray-500">{c.address?.city || '—'}</td>
                  <td className="px-4 py-3">{(c.lists || []).length}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.engagement?.engagementScore > 50 ? 'bg-green-100 text-green-700' : c.engagement?.engagementScore > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.engagement?.engagementScore || 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && <p className="text-xs text-gray-400 p-3 text-center">Showing first 100 of {filtered.length}</p>}
        </div>
      )}
    </div>
  );
}

function ContactDetail({ contact, onBack }) {
  const c = contact;
  const recentJob = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0))[0];

  return (
    <div>
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back to Contacts</button>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-800">{c.firstName} {c.lastName}</h2>
        <p className="text-gray-500 mt-1">{c.email}</p>
        {c.phone && <p className="text-gray-500 text-sm">{c.phone}</p>}
        {c.address?.street && <p className="text-gray-500 text-sm mt-1">{c.address.street}, {c.address.city} {c.address.state} {c.address.zip}</p>}

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Lists</p>
            <div className="mt-1 space-y-1">{(c.lists || []).map((l, i) => <span key={i} className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full mr-1">{l.listName}</span>)}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Tags</p>
            <div className="mt-1">{(c.tags || []).map((t, i) => <span key={i} className="inline-block text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full mr-1">{t}</span>)}</div>
          </div>
        </div>

        {recentJob && (
          <div className="mt-4 bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Most Recent Job</p>
            <p className="text-sm font-medium">{recentJob.jobType} — {recentJob.company}</p>
            <p className="text-xs text-gray-500">{recentJob.jobDate} {recentJob.jobValue ? `· $${recentJob.jobValue.toLocaleString()}` : ''}</p>
          </div>
        )}

        <div className="mt-4 bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Engagement</p>
          <div className="flex gap-4 text-sm">
            <span>Campaigns: {c.engagement?.campaignsReceived || 0}</span>
            <span>Opens: {c.engagement?.totalOpens || 0}</span>
            <span>Clicks: {c.engagement?.totalClicks || 0}</span>
            <span className="font-medium">Score: {c.engagement?.engagementScore || 0}</span>
          </div>
        </div>

        {c.intelligenceProfile?.personalNotes && (
          <div className="mt-4 bg-yellow-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Personal Notes (from field)</p>
            <p className="text-sm">{c.intelligenceProfile.personalNotes}</p>
          </div>
        )}

        {/* Engagement Dashboard */}
        <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Engagement Dashboard</h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="bg-blue-50 rounded-lg p-2"><p className="text-lg font-bold text-blue-700">{c.engagement?.campaignsReceived || 0}</p><p className="text-xs text-blue-500">Received</p></div>
            <div className="bg-green-50 rounded-lg p-2"><p className="text-lg font-bold text-green-700">{c.engagement?.totalOpens || 0}</p><p className="text-xs text-green-500">Opens</p></div>
            <div className="bg-purple-50 rounded-lg p-2"><p className="text-lg font-bold text-purple-700">{c.engagement?.totalClicks || 0}</p><p className="text-xs text-purple-500">Clicks</p></div>
            <div className="bg-orange-50 rounded-lg p-2"><p className="text-lg font-bold text-orange-700">{c.engagement?.engagementScore || 0}</p><p className="text-xs text-orange-500">Score</p></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-500">Trend:</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              c.engagement?.engagementTrend === 'rising' ? 'bg-green-100 text-green-700' :
              c.engagement?.engagementTrend === 'stable' ? 'bg-blue-100 text-blue-700' :
              c.engagement?.engagementTrend === 'cooling' ? 'bg-yellow-100 text-yellow-700' :
              'bg-gray-100 text-gray-500'
            }`}>{c.engagement?.engagementTrend || 'new'}</span>
            {c.engagement?.recommendedSender && <span className="text-xs text-gray-400">· Recommended: {c.engagement.recommendedSenderName || c.engagement.recommendedSender}</span>}
          </div>

          {/* Recommended Next Action */}
          <div className="mt-3 bg-gray-50 rounded-lg p-2">
            <p className="text-xs text-gray-500 mb-1">Recommended Action:</p>
            <p className="text-sm text-gray-700">{
              (c.engagement?.engagementTrend === 'dormant') ? '💤 Dormant 90+ days — consider re-engagement campaign or remove from active list' :
              (c.engagement?.totalClicks > 0 && (c.engagement?.totalOpens || 0) > 2) ? '🎯 Clicking but not converting — prioritize for personal outreach' :
              (c.engagement?.totalOpens > 2 && !c.engagement?.totalClicks) ? '📖 Opening but not clicking — try different angle or CTA' :
              (c.engagement?.engagementTrend === 'rising') ? '📈 Engagement rising — great time to reach out' :
              '📬 Send first campaign to start building engagement data'
            }</p>
          </div>

          {c.engagement?.lastOpenDate && <p className="text-xs text-gray-400 mt-2">Last engagement: {new Date(c.engagement.lastOpenDate).toLocaleDateString()}</p>}
        </div>

        {/* Tier & Sender */}
        <div className="mt-4 bg-indigo-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Relationship Tier</p>
          <p className="text-sm font-medium">{c.currentTier || 'general'} · Sender: {c.engagement?.recommendedSenderName || 'Not assigned'}</p>
        </div>
      </div>
    </div>
  );
}
