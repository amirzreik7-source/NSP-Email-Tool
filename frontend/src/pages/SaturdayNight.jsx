import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function SaturdayNight() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/saturday-night/queue`);
      const data = await res.json();
      setQueue(data.filter(i => i.status === 'pending' || i.status === 'auto_sent' || i.status === 'manual_sent').sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || '')));
    } catch(e) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); const interval = setInterval(load, 30000); return () => clearInterval(interval); }, [load]);

  const sendNow = async (id) => {
    await fetch(`${API}/api/saturday-night/send/${id}`, { method: 'POST' });
    load();
  };

  const dismiss = async (id) => {
    await fetch(`${API}/api/saturday-night/dismiss/${id}`, { method: 'POST' });
    load();
  };

  const getTimeLeft = (autoSendTime) => {
    const diff = new Date(autoSendTime) - new Date();
    if (diff <= 0) return 'Sending...';
    const min = Math.floor(diff / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const pending = queue.filter(i => i.status === 'pending');
  const sent = queue.filter(i => i.status === 'auto_sent' || i.status === 'manual_sent');

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🌙 Saturday Night Engine</h1>
        <p className="text-sm text-gray-500">Auto-responds to website leads within 15 minutes. The ONLY auto-send in the system.</p>
      </div>

      {pending.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-red-700 mb-3">🔔 {pending.length} lead{pending.length !== 1 ? 's' : ''} pending response</h3>
          <div className="space-y-3">
            {pending.map(item => (
              <div key={item.id} className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-semibold text-gray-800">{item.firstName} {item.lastName}</h4>
                    <p className="text-sm text-gray-500">{item.email || item.phone} · {item.address}</p>
                    <p className="text-xs text-gray-400">{item.serviceType} · "{item.message?.substring(0, 80)}"</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-600">{getTimeLeft(item.autoSendTime)}</p>
                    <p className="text-xs text-red-500">auto-send countdown</p>
                  </div>
                </div>

                {item.aiResponse && (
                  <div className="bg-white rounded-lg p-3 mb-3">
                    <p className="text-xs text-green-600 font-medium mb-1">AI Response Ready:</p>
                    <p className="text-sm text-gray-700">{item.aiResponse.text}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => sendNow(item.id)} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">✓ Send Now</button>
                  <button className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm">✏️ Edit</button>
                  <button onClick={() => dismiss(item.id)} className="px-4 py-2 bg-gray-100 text-gray-500 rounded-lg text-sm">Disable Auto-Send</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center mb-6">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-green-800 font-medium">All caught up — no pending leads</p>
          <p className="text-sm text-green-600">The engine is watching for new website form submissions 24/7</p>
        </div>
      )}

      {sent.length > 0 && (
        <div>
          <h3 className="font-semibold text-gray-700 mb-3">Recent Responses ({sent.length})</h3>
          <div className="space-y-2">
            {sent.slice(0, 20).map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{item.firstName} {item.lastName}</p>
                    <p className="text-xs text-gray-500">{item.email || item.phone} · {item.serviceType}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${item.status === 'auto_sent' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                      {item.status === 'auto_sent' ? 'Auto-sent' : 'Sent manually'}
                    </span>
                    <p className="text-xs text-gray-400 mt-1">{item.sentAt ? new Date(item.sentAt).toLocaleString() : ''}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
