import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function SenderProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/sender-profiles`).then(r => r.json()).then(p => { setProfiles(p); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const save = async (profile) => {
    try {
      if (profile.id && !profile.id.startsWith('default_')) {
        await fetch(`${API}/api/sender-profiles/${profile.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
      } else {
        const res = await fetch(`${API}/api/sender-profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
        const data = await res.json();
        profile.id = data.id;
      }
      setProfiles(profiles.map(p => p.id === profile.id ? profile : p));
      setEditing(null);
    } catch (e) {}
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Sender Profiles</h2>
        <p className="text-sm text-gray-500">Configure sender identity, signature, and writing style for AI generation.</p>
      </div>

      {profiles.map(profile => (
        <div key={profile.id} className="bg-white rounded-xl border border-gray-200 p-5">
          {editing === profile.id ? (
            <EditProfile profile={profile} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{profile.name}</h3>
                  <p className="text-sm text-gray-500">{profile.title} · {profile.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${profile.tier === 'personal' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {profile.tier === 'personal' ? 'Personal' : 'Professional'}
                  </span>
                  <button onClick={() => setEditing(profile.id)} className="text-xs text-blue-600 hover:underline">Edit</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Signature</p>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{profile.signature}</pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Writing Style</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{profile.styleNotes}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EditProfile({ profile, onSave, onCancel }) {
  const [form, setForm] = useState({ ...profile });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
          <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
          <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
      </div>
      <div><label className="block text-xs font-medium text-gray-600 mb-1">Signature</label>
        <textarea value={form.signature} onChange={e => setForm({ ...form, signature: e.target.value })} rows={4} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" /></div>
      <div><label className="block text-xs font-medium text-gray-600 mb-1">Writing Style Notes (for AI)</label>
        <textarea value={form.styleNotes} onChange={e => setForm({ ...form, styleNotes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="e.g., Casual, direct. Uses 'Hey' not 'Dear'. Signs off with first name only." /></div>
      <div className="flex gap-2">
        <button onClick={() => onSave(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
        <button onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  );
}
