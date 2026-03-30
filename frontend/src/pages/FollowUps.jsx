import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';
const FOLLOWUPS_COL = 'followUpSequences';

const SEQUENCE_TEMPLATES = [
  { name: 'Estimate Follow-Up', steps: [
    { day: 3, channel: 'text', goal: 'Soft check-in after estimate' },
    { day: 7, channel: 'email', goal: 'Share relevant before/after photo' },
    { day: 14, channel: 'text', goal: 'Mention spring schedule filling up' },
    { day: 21, channel: 'email', goal: 'Final gentle touch — no pressure' },
  ]},
  { name: 'Re-engagement (Cold)', steps: [
    { day: 0, channel: 'email', goal: 'Initial re-engagement — are you thinking about painting?' },
    { day: 7, channel: 'text', goal: 'Short personal text follow-up' },
    { day: 21, channel: 'email', goal: 'Different angle — seasonal offer' },
  ]},
  { name: 'Post-Job (Review + Referral)', steps: [
    { day: 1, channel: 'text', goal: 'Thank you — how does everything look?' },
    { day: 7, channel: 'text', goal: 'Google review request with direct link' },
    { day: 30, channel: 'email', goal: 'Referral ask with $200 bonus mention' },
    { day: 365, channel: 'email', goal: '1-year anniversary with before/after photo' },
  ]},
];

export default function FollowUps() {
  const [sequences, setSequences] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      const [seqs, allContacts] = await Promise.all([
        getDocs(query(collection(db, FOLLOWUPS_COL), where('userId', '==', uid))),
        getAllContacts(uid),
      ]);
      setSequences(seqs.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      setContacts(allContacts);
      setLoading(false);
    })();
  }, []);

  // Find sequences that have steps due today
  const today = new Date().toISOString().split('T')[0];
  const dueToday = sequences.filter(s => {
    if (s.status !== 'active') return false;
    const startDate = new Date(s.startDate);
    return s.steps.some((step, i) => {
      if (step.completed) return false;
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() + step.day);
      return dueDate.toISOString().split('T')[0] === today;
    });
  });

  if (showCreate) return <CreateSequence contacts={contacts} onDone={() => { setShowCreate(false); window.location.reload(); }} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📋 Follow-Up Sequences</h1>
          <p className="text-sm text-gray-500 mt-1">{sequences.length} active sequences</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ New Sequence</button>
      </div>

      {dueToday.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-red-800">🔔 {dueToday.length} follow-up{dueToday.length > 1 ? 's' : ''} due today</h3>
          <div className="mt-2 space-y-2">
            {dueToday.map(s => (
              <div key={s.id} className="bg-white rounded-lg p-3 border border-red-100">
                <p className="font-medium text-gray-800">{s.contactName}</p>
                <p className="text-sm text-gray-500">{s.templateName}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <p className="text-gray-400 text-center py-10">Loading...</p> : sequences.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-gray-500">No follow-up sequences yet.</p>
          <p className="text-gray-400 text-sm mt-1">Create automated follow-up sequences for estimates and customers.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map(s => {
            const completedSteps = s.steps.filter(st => st.completed).length;
            const totalSteps = s.steps.length;
            return (
              <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-800">{s.contactName}</h3>
                    <p className="text-sm text-gray-500">{s.templateName} · Started {new Date(s.startDate).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {s.status}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(completedSteps / totalSteps) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500">{completedSteps}/{totalSteps}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {s.steps.map((step, i) => (
                      <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${step.completed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        Day {step.day}: {step.channel === 'text' ? '💬' : '📧'} {step.completed ? '✓' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateSequence({ contacts, onDone }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = contacts.filter(c => (c.firstName + ' ' + c.lastName + ' ' + c.email).toLowerCase().includes(search.toLowerCase())).slice(0, 15);

  const create = async () => {
    if (!selectedContact || !selectedTemplate) return;
    await addDoc(collection(db, FOLLOWUPS_COL), {
      userId: auth.currentUser.uid,
      contactId: selectedContact.id,
      contactName: selectedContact.firstName + ' ' + selectedContact.lastName,
      contactEmail: selectedContact.email,
      contactPhone: selectedContact.phone || '',
      templateName: selectedTemplate.name,
      steps: selectedTemplate.steps.map(s => ({ ...s, completed: false })),
      startDate: new Date().toISOString(),
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    onDone();
  };

  return (
    <div>
      <button onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">New Follow-Up Sequence</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Template</label>
          <div className="grid gap-3">
            {SEQUENCE_TEMPLATES.map(t => (
              <button key={t.name} onClick={() => setSelectedTemplate(t)}
                className={`p-4 rounded-xl border text-left transition ${selectedTemplate?.name === t.name ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className="font-medium text-gray-800">{t.name}</p>
                <div className="flex gap-2 mt-2">
                  {t.steps.map((s, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      Day {s.day}: {s.channel === 'text' ? '💬' : '📧'}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Contact</label>
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2" />
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {filtered.map(c => (
              <button key={c.id} onClick={() => setSelectedContact(c)}
                className={`w-full text-left p-3 rounded-lg border transition ${selectedContact?.id === c.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <p className="text-sm font-medium">{c.firstName} {c.lastName}</p>
                <p className="text-xs text-gray-500">{c.email} · {c.address?.city || ''}</p>
              </button>
            ))}
          </div>
        </div>

        <button onClick={create} disabled={!selectedContact || !selectedTemplate}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
          Start Sequence →
        </button>
      </div>
    </div>
  );
}
