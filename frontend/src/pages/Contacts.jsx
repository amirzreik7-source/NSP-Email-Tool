import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const navigate = useNavigate();
  const perPage = 50;

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

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = ((a.firstName || '') + ' ' + (a.lastName || '')).localeCompare((b.firstName || '') + ' ' + (b.lastName || ''));
      else if (sortBy === 'email') cmp = (a.email || '').localeCompare(b.email || '');
      else if (sortBy === 'city') cmp = (a.address?.city || '').localeCompare(b.address?.city || '');
      else if (sortBy === 'score') cmp = (a.engagement?.engagementScore || 0) - (b.engagement?.engagementScore || 0);
      else if (sortBy === 'lists') cmp = (a.lists || []).length - (b.lists || []).length;
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [contacts, search, cityFilter, tierFilter, sortBy, sortOrder]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, cityFilter, tierFilter]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const pageContacts = filtered.slice((page - 1) * perPage, page * perPage);

  const toggleSort = (col) => {
    if (sortBy === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortOrder('asc'); }
  };
  const sortIcon = (col) => sortBy === col ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

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
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('name')}>Name{sortIcon('name')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('email')}>Email{sortIcon('email')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('city')}>City{sortIcon('city')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('lists')}>Lists{sortIcon('lists')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 cursor-pointer select-none" onClick={() => toggleSort('score')}>Score{sortIcon('score')}</th>
              </tr>
            </thead>
            <tbody>
              {pageContacts.map(c => (
                <tr key={c.id} onClick={() => navigate(`/contacts/profile/${c.id}`)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
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
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} contacts
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                className="px-3 py-1 border rounded-lg text-xs disabled:opacity-30">Previous</button>
              <span className="text-xs text-gray-600">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className="px-3 py-1 border rounded-lg text-xs disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

