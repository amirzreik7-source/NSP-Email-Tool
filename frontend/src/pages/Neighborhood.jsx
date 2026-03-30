import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

export default function Neighborhood() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jobAddress, setJobAddress] = useState('');
  const [radius, setRadius] = useState(0.5);
  const [nearbyResults, setNearbyResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await getAllContacts(auth.currentUser.uid);
      setContacts(data);
      setLoading(false);
    })();
  }, []);

  const searchNearby = async () => {
    if (!jobAddress.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API}/api/neighborhood/find-nearby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobAddress, contacts, radiusMiles: radius }),
      });
      const data = await res.json();
      setNearbyResults(data);
    } catch(e) { alert('Search failed: ' + e.message); }
    setSearching(false);
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">📍 Neighborhood Campaigns</h1>
      <p className="text-sm text-gray-500 mb-6">Find contacts near a completed job and launch hyper-local campaigns</p>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-semibold text-gray-700 mb-3">Find Nearby Contacts</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Address (completed job location)</label>
            <input type="text" value={jobAddress} onChange={e => setJobAddress(e.target.value)}
              placeholder="e.g., 456 Oak Lane, Vienna, VA" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Radius</label>
            <div className="flex gap-2">
              {[0.25, 0.5, 1].map(r => (
                <button key={r} onClick={() => setRadius(r)}
                  className={`px-3 py-1.5 rounded-lg text-sm ${radius === r ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {r} mile{r !== 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>
          <button onClick={searchNearby} disabled={searching || !jobAddress.trim()}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            {searching ? '🔍 Searching...' : `🔍 Find Contacts Within ${radius} Mile${radius !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {nearbyResults && (
        <div>
          {nearbyResults.nearby?.length > 0 ? (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <h3 className="font-semibold text-green-800">📍 {nearbyResults.nearby.length} contacts found within {radius} mile{radius !== 1 ? 's' : ''}</h3>
                <p className="text-sm text-green-600 mt-1">of {jobAddress}</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50">
                    <th className="text-left px-4 py-2 text-gray-500 text-xs">Name</th>
                    <th className="text-left px-4 py-2 text-gray-500 text-xs">Address</th>
                    <th className="text-left px-4 py-2 text-gray-500 text-xs">Distance</th>
                    <th className="text-left px-4 py-2 text-gray-500 text-xs">Tier</th>
                  </tr></thead>
                  <tbody>
                    {nearbyResults.nearby.map(c => (
                      <tr key={c.id} className="border-b border-gray-50">
                        <td className="px-4 py-2 font-medium">{c.firstName} {c.lastName}</td>
                        <td className="px-4 py-2 text-gray-500">{c.address?.street}, {c.address?.city}</td>
                        <td className="px-4 py-2 text-gray-500">{c.distance} mi</td>
                        <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${c.currentTier === 'personal' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c.currentTier || 'general'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button onClick={() => window.location.href = '/ai-campaign'} className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium">
                🤖 Launch Neighborhood AI Campaign for {nearbyResults.nearby.length} contacts →
              </button>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
              <p className="text-yellow-800">No contacts found within {radius} mile{radius !== 1 ? 's' : ''} of this address.</p>
              <p className="text-sm text-yellow-600 mt-1">Try increasing the radius or check the address.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
