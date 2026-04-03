import { useState } from 'react';
import { auth } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || '';

export default function NearbyContacts() {
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(0.5);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  const search = async () => {
    if (!address.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`${API}/api/contacts/nearby`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, radiusMiles: radius, userId: auth.currentUser.uid }),
      });
      const data = await res.json();
      setResults(data);
    } catch (e) {
      setResults({ nearby: [], error: e.message });
    }
    setSearching(false);
  };

  const recentlyEmailed = (contact) => {
    const lastOpen = contact.engagement?.lastOpenDate;
    if (!lastOpen) return false;
    const days = Math.floor((Date.now() - new Date(lastOpen).getTime()) / (1000*60*60*24));
    return days <= 14;
  };

  const [geocodeStatus, setGeocodeStatus] = useState(null);

  const triggerGeocode = async () => {
    setGeocodeStatus('running');
    try {
      const res = await fetch(`${API}/api/contacts/geocode-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: auth.currentUser.uid }),
      });
      const data = await res.json();
      setGeocodeStatus(`done: ${data.geocoded} geocoded, ${data.failed} failed`);
    } catch (e) { setGeocodeStatus('error: ' + e.message); }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Nearby Contact Search</h2>

      {/* Geocode banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-800">Proximity search requires geocoded addresses</p>
            <p className="text-xs text-amber-600 mt-1">
              {geocodeStatus === 'running' ? 'Geocoding in progress...' :
               geocodeStatus?.startsWith('done') ? geocodeStatus :
               geocodeStatus?.startsWith('error') ? geocodeStatus :
               'Run geocoding to enable nearby search for all contacts'}
            </p>
          </div>
          <button onClick={triggerGeocode} disabled={geocodeStatus === 'running'}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {geocodeStatus === 'running' ? 'Running...' : 'Geocode Now'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Address</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="e.g., 4600 S Four Mile Run Dr Arlington VA"
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="w-32">
            <label className="block text-sm font-medium text-gray-700 mb-1">Radius</label>
            <select value={radius} onChange={e => setRadius(parseFloat(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value={0.1}>0.1 mi</option>
              <option value={0.25}>0.25 mi</option>
              <option value={0.5}>0.5 mi</option>
              <option value={1}>1 mi</option>
              <option value={2}>2 mi</option>
              <option value={5}>5 mi</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={search} disabled={searching || !address.trim()}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {results && (
        <div>
          {results.error && <p className="text-red-600 text-sm mb-3">{results.error}</p>}

          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">
              {results.nearby?.length || 0} contacts found within {radius} miles
            </p>
            {results.nearby?.length > 0 && (
              <button onClick={() => navigate('/campaign/new')}
                className="text-sm font-medium text-blue-600 hover:underline">
                Start Campaign with These →
              </button>
            )}
          </div>

          {results.nearby?.some(c => recentlyEmailed(c)) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <p className="text-sm text-amber-800">⚠️ {results.nearby.filter(c => recentlyEmailed(c)).length} contacts were emailed in the last 14 days</p>
            </div>
          )}

          <div className="space-y-2">
            {(results.nearby || []).map((c, i) => (
              <div key={c.id || i} onClick={() => navigate(`/contacts/profile/${c.id}`)} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between cursor-pointer hover:shadow-sm transition">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-800">{c.firstName} {c.lastName}</p>
                    <span className="text-xs text-gray-500">{c.distance} mi</span>
                    {c.stormScore?.score && (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.stormScore.score >= 70 ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'}`}>{c.stormScore.score}</span>
                    )}
                    {recentlyEmailed(c) && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Recently emailed</span>}
                  </div>
                  <p className="text-sm text-gray-500">{c.address?.street || ''}, {c.address?.city || ''} · {c.email || 'No email'}</p>
                  <p className="text-xs text-gray-400">{(c.lists || []).map(l => l.listName).join(', ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
