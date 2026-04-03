import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';

const API = import.meta.env.VITE_API_URL || '';

const JOBS = [
  { key: 'stormScore', name: 'Storm Score Recalc', time: '5:00am', icon: '⚡' },
  { key: 'fairfaxDeeds', name: 'Fairfax Deeds', time: '6:00am', icon: '🏠' },
  { key: 'arlingtonDeeds', name: 'Arlington Deeds', time: '6:02am', icon: '🏠' },
  { key: 'loudounDeeds', name: 'Loudoun Deeds', time: '6:04am', icon: '🏠' },
  { key: 'alexandriaDeeds', name: 'Alexandria Deeds', time: '6:06am', icon: '🏠' },
  { key: 'mdSdat', name: 'MD SDAT', time: '6:08am', icon: '🏠' },
  { key: 'permits', name: 'Permit Monitor', time: '7:00am', icon: '📋' },
  { key: 'skipTrace', name: 'Skip Trace Queue', time: '8:00am', icon: '🔍' },
  { key: 'streetView', name: 'Street View Analysis', time: '9:00am', icon: '📸' },
  { key: 'outreach', name: 'Outreach Generation', time: '10:00am', icon: '✉️' },
];

export default function SystemHealth() {
  const [health, setHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [h, n] = await Promise.all([
          fetch(`${API}/api/system-health`).then(r => r.json()),
          fetch(`${API}/api/notifications`).then(r => r.json()),
        ]);
        setHealth(h);
        setNotifications(n);
      } catch(e) {}
      setLoading(false);
    })();
  }, []);

  const triggerJob = async (jobName) => {
    await fetch(`${API}/api/cron/run/${jobName}`, { method: 'POST' });
    alert(`${jobName} started`);
  };

  const sendDigest = async () => {
    const res = await fetch(`${API}/api/digest/send`, { method: 'POST' });
    const data = await res.json();
    alert(data.ok ? 'Digest sent!' : 'Failed: ' + data.error);
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading system status...</p>;

  const allOk = JOBS.every(j => !health[j.key]?.status || health[j.key]?.status !== 'error');

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🔧 System Health</h1>
          <p className="text-sm text-gray-500">Cron job status and automation monitoring</p>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-sm font-medium ${allOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {allOk ? '✅ All Operational' : '🚨 Issues Detected'}
        </div>
      </div>

      {/* Cron Jobs */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-semibold text-gray-700 mb-3">Cron Job Status</h3>
        <div className="space-y-2">
          {JOBS.map(job => {
            const status = health[job.key] || {};
            const isOk = status.status === 'completed' || status.status === 'idle';
            const isRunning = status.status === 'running';
            const isError = status.status === 'error';
            return (
              <div key={job.key} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isError ? 'bg-red-500' : isRunning ? 'bg-yellow-500 animate-pulse' : isOk ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-sm">{job.icon} {job.name}</span>
                  <span className="text-xs text-gray-400">{job.time}</span>
                </div>
                <div className="flex items-center gap-2">
                  {status.lastRun && <span className="text-xs text-gray-400">{new Date(status.lastRun).toLocaleString()}</span>}
                  {status.leadsFound > 0 && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{status.leadsFound} leads</span>}
                  <button onClick={() => triggerJob(job.key)} className="text-xs text-blue-600 hover:underline">Run</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <button onClick={sendDigest} className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md transition">
          <p className="font-medium text-gray-800">📧 Send Daily Digest</p>
          <p className="text-xs text-gray-500">Send morning update email now</p>
        </button>
        <button onClick={() => triggerJob('stormScore')} className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md transition">
          <p className="font-medium text-gray-800">⚡ Recalculate Scores</p>
          <p className="text-xs text-gray-500">Update all Storm Scores now</p>
        </button>
        <button onClick={async () => {
          try {
            const uid = auth.currentUser?.uid;
            if (!uid) { alert('Not logged in'); return; }
            const res = await fetch(`${API}/api/contacts/geocode-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: uid }) });
            const data = await res.json();
            alert(`Geocoded: ${data.geocoded}, Failed: ${data.failed}, Total: ${data.total}`);
          } catch (e) { alert('Error: ' + e.message); }
        }} className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md transition">
          <p className="font-medium text-gray-800">📍 Geocode All Contacts</p>
          <p className="text-xs text-gray-500">Add coordinates for proximity search</p>
        </button>
      </div>

      {/* Recent Notifications */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-700 mb-3">Recent Notifications</h3>
        {notifications.length === 0 ? (
          <p className="text-gray-400 text-sm">No notifications yet.</p>
        ) : (
          <div className="space-y-2">
            {notifications.slice(-15).reverse().map(n => (
              <div key={n.id} className={`flex items-start gap-2 py-2 border-b border-gray-50 ${n.read ? 'opacity-60' : ''}`}>
                <span className="text-sm">{n.type === 'error' ? '🚨' : n.type === 'lead' ? '🔥' : '📬'}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{n.title}</p>
                  <p className="text-xs text-gray-500">{n.body}</p>
                  <p className="text-xs text-gray-400">{new Date(n.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
