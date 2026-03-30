import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts, getAllLists, getContactsByList } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

export default function AdExport() {
  const [contacts, setContacts] = useState([]);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('google');
  const [source, setSource] = useState('all');
  const [selectedListId, setSelectedListId] = useState('');
  const [engagementFilter, setEngagementFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const [c, l] = await Promise.all([getAllContacts(auth.currentUser.uid), getAllLists(auth.currentUser.uid)]);
      setContacts(c);
      setLists(l);
      setLoading(false);
    })();
  }, []);

  const getFilteredContacts = () => {
    let result = contacts;
    if (source === 'list' && selectedListId) {
      result = result.filter(c => c.lists?.some(l => l.listId === selectedListId));
    }
    if (engagementFilter === 'opened') result = result.filter(c => (c.engagement?.totalOpens || 0) > 0);
    if (engagementFilter === 'clicked') result = result.filter(c => (c.engagement?.totalClicks || 0) > 0);
    if (engagementFilter === 'never') result = result.filter(c => (c.engagement?.totalOpens || 0) === 0);
    return result;
  };

  const exportContacts = async () => {
    const filtered = getFilteredContacts();
    if (!filtered.length) { alert('No contacts to export'); return; }

    try {
      const res = await fetch(`${API}/api/export/customer-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: filtered, platform }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer-match-${platform}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert('Export failed: ' + e.message);
    }
  };

  const filtered = getFilteredContacts();

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">📤 Export for Ads</h1>
      <p className="text-sm text-gray-500 mb-6">Export contacts for Google Ads Customer Match or Meta Custom Audiences</p>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setPlatform('google')} className={`p-3 rounded-lg border text-sm text-left ${platform === 'google' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">Google Ads</p><p className="text-xs text-gray-500">Customer Match</p>
            </button>
            <button onClick={() => setPlatform('meta')} className={`p-3 rounded-lg border text-sm text-left ${platform === 'meta' ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">Meta (Facebook)</p><p className="text-xs text-gray-500">Custom Audiences</p>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Contact Source</label>
          <select value={source} onChange={e => setSource(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="all">All contacts ({contacts.length})</option>
            <option value="list">From specific list</option>
          </select>
          {source === 'list' && (
            <select value={selectedListId} onChange={e => setSelectedListId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-2">
              <option value="">Select list...</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.contactCount})</option>)}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Engagement Filter</label>
          <select value={engagementFilter} onChange={e => setEngagementFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="all">All contacts</option>
            <option value="opened">Opened at least one email</option>
            <option value="clicked">Clicked a link</option>
            <option value="never">Never engaged (retarget these)</option>
          </select>
        </div>

        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-sm"><strong>{filtered.length}</strong> contacts will be exported</p>
          <p className="text-xs text-gray-500 mt-1">Format: {platform === 'google' ? 'Google Ads Customer Match CSV' : 'Meta Custom Audiences CSV'}</p>
        </div>

        <button onClick={exportContacts} disabled={!filtered.length}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
          📥 Download {platform === 'google' ? 'Google' : 'Meta'} CSV ({filtered.length} contacts)
        </button>
      </div>
    </div>
  );
}
