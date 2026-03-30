import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { getList, updateList, getContactsByList } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

export default function ListDetail() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    (async () => {
      const [l, c] = await Promise.all([
        getList(listId),
        getContactsByList(auth.currentUser.uid, listId),
      ]);
      setList(l);
      setContacts(c);
      setLoading(false);
    })();
  }, [listId]);

  const runAIAnalysis = async () => {
    setAnalyzing(true);
    try {
      const sample = contacts.slice(0, 20).map(c => ({
        email: c.email, firstName: c.firstName, lastName: c.lastName,
        city: c.address?.city, state: c.address?.state,
        jobType: c.jobHistory?.[0]?.jobType, jobDate: c.jobHistory?.[0]?.jobDate,
        jobValue: c.jobHistory?.[0]?.jobValue,
      }));

      const res = await fetch(`${API}/api/ai/analyze-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userContext: list.userContext || '',
          csvSample: sample,
          totalCount: contacts.length,
          columns: ['email', 'firstName', 'lastName', 'city', 'state', 'jobType', 'jobDate', 'jobValue'],
        }),
      });

      const analysis = await res.json();
      await updateList(listId, { aiAnalysis: analysis });
      setList(prev => ({ ...prev, aiAnalysis: analysis }));
    } catch (e) {
      alert('Analysis failed: ' + e.message);
    }
    setAnalyzing(false);
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;
  if (!list) return <p className="text-red-500 text-center py-10">List not found.</p>;

  const ai = list.aiAnalysis;

  return (
    <div>
      <button onClick={() => navigate('/lists')} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back to Lists</button>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{list.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{contacts.length} contacts · {list.tier} · Uploaded {new Date(list.createdAt).toLocaleDateString()}</p>
        </div>
        <button onClick={() => navigate('/campaigns')} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Create Campaign →</button>
      </div>

      {list.userContext && (
        <div className="bg-gray-50 rounded-xl p-4 mb-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Owner's Description</p>
          <p className="text-sm text-gray-700">{list.userContext}</p>
        </div>
      )}

      {/* AI Analysis */}
      {!ai ? (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-6 text-center mb-6">
          <p className="text-2xl mb-2">🤖</p>
          <p className="font-medium text-purple-800">AI hasn't analyzed this list yet</p>
          <p className="text-sm text-purple-600 mt-1">AI will identify demographics, patterns, and recommend messaging strategy.</p>
          <button onClick={runAIAnalysis} disabled={analyzing} className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {analyzing ? '⏳ Analyzing...' : '✨ Run AI Analysis'}
          </button>
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-700 mb-2">🤖 AI Analysis</h3>
            <p className="text-sm text-gray-600">{ai.persona}</p>
            <div className="flex gap-2 mt-3">
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Sender: {ai.recommendedSender?.includes('amirz') ? 'Amir' : 'Mary'}</span>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Tone: {ai.recommendedTone}</span>
            </div>
          </div>

          {ai.demographics?.locations && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-2">Top Cities</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ai.demographics.locations).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([city, count]) => (
                  <span key={city} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">{city}: {count}</span>
                ))}
              </div>
            </div>
          )}

          {ai.patterns?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-2">Patterns</h3>
              <ul className="text-sm text-gray-600 space-y-1">{ai.patterns.map((p, i) => <li key={i}>• {p}</li>)}</ul>
            </div>
          )}

          {ai.segmentOpportunities?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-700 mb-2">Segment Opportunities</h3>
              <div className="space-y-2">
                {ai.segmentOpportunities.map((s, i) => (
                  <div key={i} className="bg-green-50 rounded-lg p-3">
                    <p className="font-medium text-gray-800 text-sm">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.angle} · ~{s.estimatedCount} contacts</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={runAIAnalysis} disabled={analyzing} className="text-sm text-purple-600 hover:underline">
            {analyzing ? 'Re-analyzing...' : '🔄 Re-run analysis'}
          </button>
        </div>
      )}

      {/* Contact preview */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-700 text-sm">Contacts in this list ({contacts.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50"><th className="text-left px-4 py-2 text-gray-500 text-xs">Name</th><th className="text-left px-4 py-2 text-gray-500 text-xs">Email</th><th className="text-left px-4 py-2 text-gray-500 text-xs">City</th></tr></thead>
          <tbody>
            {contacts.slice(0, 20).map(c => (
              <tr key={c.id} className="border-b border-gray-50">
                <td className="px-4 py-2">{c.firstName} {c.lastName}</td>
                <td className="px-4 py-2 text-gray-500">{c.email}</td>
                <td className="px-4 py-2 text-gray-500">{c.address?.city || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {contacts.length > 20 && <p className="text-xs text-gray-400 p-3 text-center">Showing 20 of {contacts.length}</p>}
      </div>
    </div>
  );
}
