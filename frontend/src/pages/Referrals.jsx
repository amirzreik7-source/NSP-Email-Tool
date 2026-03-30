import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';

export default function Referrals() {
  const [contacts, setContacts] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [referrerSearch, setReferrerSearch] = useState('');
  const [referredSearch, setReferredSearch] = useState('');
  const [selectedReferrer, setSelectedReferrer] = useState(null);
  const [selectedReferred, setSelectedReferred] = useState(null);

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      const [c, r] = await Promise.all([
        getAllContacts(uid),
        getDocs(query(collection(db, 'referrals'), where('userId', '==', uid))),
      ]);
      setContacts(c);
      setReferrals(r.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, []);

  // Build referrer stats
  const referrerStats = {};
  referrals.forEach(r => {
    if (!referrerStats[r.referrerId]) referrerStats[r.referrerId] = { count: 0, totalValue: 0, name: r.referrerName };
    referrerStats[r.referrerId].count++;
    referrerStats[r.referrerId].totalValue += r.referredJobValue || 0;
  });
  const topReferrers = Object.entries(referrerStats).sort((a, b) => b[1].count - a[1].count).map(([id, data]) => ({ id, ...data }));

  const addReferral = async () => {
    if (!selectedReferrer || !selectedReferred) return;
    await addDoc(collection(db, 'referrals'), {
      userId: auth.currentUser.uid,
      referrerId: selectedReferrer.id,
      referrerName: `${selectedReferrer.firstName} ${selectedReferrer.lastName}`,
      referredId: selectedReferred.id,
      referredName: `${selectedReferred.firstName} ${selectedReferred.lastName}`,
      referredJobValue: 0,
      status: 'pending',
      rewardStatus: 'unredeemed',
      date: new Date().toISOString(),
    });
    setShowAdd(false);
    setSelectedReferrer(null);
    setSelectedReferred(null);
    // Reload
    const r = await getDocs(query(collection(db, 'referrals'), where('userId', '==', auth.currentUser.uid)));
    setReferrals(r.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const filteredReferrers = contacts.filter(c => (c.firstName + ' ' + c.lastName).toLowerCase().includes(referrerSearch.toLowerCase())).slice(0, 10);
  const filteredReferred = contacts.filter(c => (c.firstName + ' ' + c.lastName).toLowerCase().includes(referredSearch.toLowerCase())).slice(0, 10);
  const unredeemedCount = referrals.filter(r => r.rewardStatus === 'unredeemed' && r.status === 'won').length;

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🔗 Referrals</h1>
          <p className="text-sm text-gray-500">{referrals.length} referrals tracked</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">+ Log Referral</button>
      </div>

      {unredeemedCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
          <p className="text-sm text-yellow-800 font-medium">🎁 {unredeemedCount} referrer{unredeemedCount !== 1 ? 's' : ''} with unredeemed rewards</p>
        </div>
      )}

      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-3">
          <h3 className="font-semibold text-gray-700">Log New Referral</h3>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Who referred? (the existing customer)</label>
            <input type="text" value={referrerSearch} onChange={e => { setReferrerSearch(e.target.value); setSelectedReferrer(null); }}
              placeholder="Search by name..." className="w-full border rounded-lg px-3 py-2 text-sm" />
            {referrerSearch && !selectedReferrer && (
              <div className="border rounded-lg mt-1 max-h-32 overflow-y-auto">
                {filteredReferrers.map(c => (
                  <button key={c.id} onClick={() => { setSelectedReferrer(c); setReferrerSearch(`${c.firstName} ${c.lastName}`); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b">{c.firstName} {c.lastName} — {c.address?.city || ''}</button>
                ))}
              </div>
            )}
            {selectedReferrer && <p className="text-xs text-green-600 mt-1">✓ {selectedReferrer.firstName} {selectedReferrer.lastName}</p>}
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Who was referred? (the new lead)</label>
            <input type="text" value={referredSearch} onChange={e => { setReferredSearch(e.target.value); setSelectedReferred(null); }}
              placeholder="Search by name..." className="w-full border rounded-lg px-3 py-2 text-sm" />
            {referredSearch && !selectedReferred && (
              <div className="border rounded-lg mt-1 max-h-32 overflow-y-auto">
                {filteredReferred.map(c => (
                  <button key={c.id} onClick={() => { setSelectedReferred(c); setReferredSearch(`${c.firstName} ${c.lastName}`); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b">{c.firstName} {c.lastName} — {c.address?.city || ''}</button>
                ))}
              </div>
            )}
            {selectedReferred && <p className="text-xs text-green-600 mt-1">✓ {selectedReferred.firstName} {selectedReferred.lastName}</p>}
          </div>
          <button onClick={addReferral} disabled={!selectedReferrer || !selectedReferred}
            className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Save Referral</button>
        </div>
      )}

      {topReferrers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="font-semibold text-gray-700 mb-3">🏆 Top Referrers</h3>
          <div className="space-y-2">
            {topReferrers.slice(0, 10).map((r, i) => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                  <span className="text-sm font-medium text-gray-800">{r.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{r.count} referral{r.count !== 1 ? 's' : ''}</span>
                  {r.totalValue > 0 && <span className="text-xs text-green-600 font-medium">${r.totalValue.toLocaleString()}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-3">All Referrals</h3>
        {referrals.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No referrals logged yet. Use "Log Referral" to track who referred whom.</p>
        ) : (
          <div className="space-y-2">
            {referrals.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div>
                  <p className="text-sm"><span className="font-medium">{r.referrerName}</span> → <span className="font-medium">{r.referredName}</span></p>
                  <p className="text-xs text-gray-400">{new Date(r.date).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'won' ? 'bg-green-100 text-green-700' : r.status === 'lost' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                  {r.status || 'pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
