import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts, getAllLists } from '../lib/contacts';
import { getAllCampaigns } from '../lib/campaigns';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [stats, setStats] = useState({ contacts: 0, lists: 0, campaigns: 0, sent: 0, delivered: 0, failed: 0 });
  const [recentCampaigns, setRecentCampaigns] = useState([]);
  const [topCities, setTopCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      const [contacts, lists, campaigns] = await Promise.all([
        getAllContacts(uid), getAllLists(uid), getAllCampaigns(uid),
      ]);

      const totalSent = campaigns.reduce((s, c) => s + (c.stats?.sent || 0), 0);
      const totalDelivered = campaigns.reduce((s, c) => s + (c.stats?.delivered || 0), 0);
      const totalFailed = campaigns.reduce((s, c) => s + (c.stats?.failed || 0), 0);

      setStats({ contacts: contacts.length, lists: lists.length, campaigns: campaigns.length, sent: totalSent, delivered: totalDelivered, failed: totalFailed });
      setRecentCampaigns(campaigns.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 5));

      // Top cities
      const cityCount = {};
      contacts.forEach(c => { const city = c.address?.city; if (city) cityCount[city] = (cityCount[city] || 0) + 1; });
      setTopCities(Object.entries(cityCount).sort((a, b) => b[1] - a[1]).slice(0, 8));
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-gray-400 text-center py-10">Loading dashboard...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Contacts" value={stats.contacts} icon="👥" onClick={() => navigate('/contacts')} />
        <StatCard label="Lists" value={stats.lists} icon="📋" onClick={() => navigate('/lists')} />
        <StatCard label="Campaigns" value={stats.campaigns} icon="📧" onClick={() => navigate('/campaigns')} />
        <StatCard label="Emails Sent" value={stats.sent} icon="📤" />
      </div>

      {stats.sent > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{stats.delivered}</p>
            <p className="text-xs text-green-600">Delivered</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{stats.failed}</p>
            <p className="text-xs text-red-600">Failed</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{stats.sent > 0 ? ((stats.delivered / stats.sent) * 100).toFixed(1) : 0}%</p>
            <p className="text-xs text-blue-600">Delivery Rate</p>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Campaigns</h2>
          {recentCampaigns.length === 0 ? (
            <p className="text-gray-400 text-sm">No campaigns yet.</p>
          ) : (
            <div className="space-y-2">
              {recentCampaigns.map(c => (
                <div key={c.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Top Cities</h2>
          {topCities.length === 0 ? (
            <p className="text-gray-400 text-sm">Upload contacts to see city breakdown.</p>
          ) : (
            <div className="space-y-2">
              {topCities.map(([city, count]) => (
                <div key={city} className="flex justify-between items-center">
                  <span className="text-sm text-gray-700">{city}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-100 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${(count / topCities[0][1]) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, onClick }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-xl border border-gray-200 p-4 ${onClick ? 'cursor-pointer hover:shadow-md' : ''} transition`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{value.toLocaleString()}</p>
        </div>
        <span className="text-xl">{icon}</span>
      </div>
    </div>
  );
}
