import { useState, useEffect, useCallback } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists, createList, upsertContact } from '../lib/contacts';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';

const TIER_COLORS = {
  general: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', label: 'General' },
  personal: { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700', label: 'Personal' },
  realtime: { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700', label: 'Real-time' },
};

export default function Lists() {
  const [lists, setLists] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadLists = useCallback(async () => {
    setLoading(true);
    const data = await getAllLists(auth.currentUser.uid);
    setLists(data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    setLoading(false);
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  if (showUpload) return <CSVUpload onDone={() => { setShowUpload(false); loadLists(); }} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Lists</h1>
        <button onClick={() => setShowUpload(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ Upload CSV</button>
      </div>
      {loading ? <p className="text-gray-400 text-center py-10">Loading...</p> : lists.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-gray-500">No lists uploaded yet.</p>
          <button onClick={() => setShowUpload(true)} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Upload your first CSV</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {lists.map(list => {
            const tier = TIER_COLORS[list.tier] || TIER_COLORS.general;
            return (
              <div key={list.id} onClick={() => navigate(`/lists/${list.id}`)} className={`${tier.bg} ${tier.border} border rounded-xl p-5 cursor-pointer hover:shadow-md transition`}>
                <div className="flex justify-between items-start">
                  <div><h3 className="font-semibold text-gray-800">{list.name}</h3><p className="text-sm text-gray-500 mt-1">{list.contactCount || 0} contacts</p></div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${tier.badge}`}>{tier.label}</span>
                </div>
                {list.userContext && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{list.userContext}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CSVUpload({ onDone }) {
  const [step, setStep] = useState(1);
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [listName, setListName] = useState('');
  const [tier, setTier] = useState('general');
  const [userContext, setUserContext] = useState('');
  const [progress, setProgress] = useState({ total: 0, processed: 0, created: 0, updated: 0, skipped: 0 });
  const [dragOver, setDragOver] = useState(false);

  const FIELDS = [
    { key: 'email', label: 'Email *' }, { key: 'firstName', label: 'First Name' }, { key: 'lastName', label: 'Last Name' },
    { key: 'phone', label: 'Phone' }, { key: 'street', label: 'Street' }, { key: 'city', label: 'City' },
    { key: 'state', label: 'State' }, { key: 'zip', label: 'Zip' }, { key: 'jobType', label: 'Job Type' },
    { key: 'jobDate', label: 'Job Date' }, { key: 'jobValue', label: 'Job Value' },
  ];

  const handleFile = (file) => {
    if (!file?.name?.endsWith('.csv')) { alert('Please upload a CSV file'); return; }
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (r) => {
        setCsvData(r.data); setHeaders(r.meta.fields || []); setListName(file.name.replace('.csv', ''));
        const auto = {};
        (r.meta.fields || []).forEach(h => {
          const l = h.toLowerCase().replace(/[^a-z]/g, '');
          if (l.includes('email')) auto.email = h;
          else if (l === 'firstname' || l === 'first') auto.firstName = h;
          else if (l === 'lastname' || l === 'last') auto.lastName = h;
          else if (l.includes('phone')) auto.phone = h;
          else if (l.includes('street') || l.includes('address')) auto.street = h;
          else if (l === 'city') auto.city = h;
          else if (l === 'state') auto.state = h;
          else if (l === 'zip' || l === 'zipcode') auto.zip = h;
        });
        setMapping(auto); setStep(2);
      },
    });
  };

  const processUpload = async () => {
    setStep(4);
    const userId = auth.currentUser.uid;
    const listId = await createList(userId, {
      name: listName, tier, userContext, contactCount: csvData.length, status: 'active',
      defaultSettings: {
        fromAddress: tier === 'personal' ? 'amirz@northernstarpainters.com' : 'mary@northernstarpainters.com',
        fromName: tier === 'personal' ? 'Amir Zreik' : 'Mary Johnson',
        relationshipType: tier, tone: tier === 'personal' ? 'warm_personal' : 'professional',
        sendingMethod: tier === 'personal' ? 'titan' : 'brevo',
      },
    });
    const listInfo = { listId, listName, tier };
    let created = 0, updated = 0, skipped = 0;
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      const r = await upsertContact(userId, {
        email: row[mapping.email] || '', firstName: row[mapping.firstName] || '', lastName: row[mapping.lastName] || '',
        phone: row[mapping.phone] || '',
        address: { street: row[mapping.street] || '', city: row[mapping.city] || '', state: row[mapping.state] || '', zip: row[mapping.zip] || '' },
        tags: [row[mapping.city], row[mapping.jobType]].filter(Boolean),
        jobHistory: row[mapping.jobType] ? [{ company: 'CertaPro', jobDate: row[mapping.jobDate] || '', jobType: row[mapping.jobType] || '', jobValue: parseFloat(row[mapping.jobValue]) || 0, salesRep: tier === 'personal' ? 'Amir' : '' }] : [],
      }, listInfo);
      if (r.status === 'created') created++; else if (r.status === 'updated') updated++; else skipped++;
      if ((i + 1) % 10 === 0 || i === csvData.length - 1) setProgress({ total: csvData.length, processed: i + 1, created, updated, skipped });
    }
    setStep(5);
  };

  if (step === 1) return (
    <div>
      <button onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back to Lists</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Upload CSV</h2>
      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}>
        <p className="text-4xl mb-3">📁</p>
        <p className="text-gray-600 font-medium">Drag & drop your CSV here</p>
        <label className="mt-3 inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm cursor-pointer hover:bg-blue-700">
          Choose File<input type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </label>
      </div>
    </div>
  );

  if (step === 2) return (
    <div>
      <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-1">Map Columns</h2>
      <p className="text-sm text-gray-500 mb-4">{csvData.length} rows. Map CSV columns to contact fields.</p>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        {FIELDS.map(f => (
          <div key={f.key} className="flex items-center gap-3">
            <label className="w-32 text-sm font-medium text-gray-700">{f.label}</label>
            <select value={mapping[f.key] || ''} onChange={e => setMapping({ ...mapping, [f.key]: e.target.value })} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">— skip —</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
      <button onClick={() => { if (!mapping.email) { alert('Email is required'); return; } setStep(3); }} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium w-full">Next →</button>
    </div>
  );

  if (step === 3) return (
    <div>
      <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">List Details</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">List Name</label><input type="text" value={listName} onChange={e => setListName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Type</label>
          <div className="grid grid-cols-3 gap-3">
            {[{ v: 'general', i: '📋', l: 'General / Cold', d: 'Don\'t know Amir' }, { v: 'personal', i: '🤝', l: 'Personal', d: 'Know Amir personally' }, { v: 'realtime', i: '⚡', l: 'Real-time', d: 'Current prospects' }].map(t => (
              <button key={t.v} onClick={() => setTier(t.v)} className={`p-3 rounded-lg border text-left text-sm ${tier === t.v ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <p>{t.i}</p><p className="font-medium text-gray-800 mt-1">{t.l}</p><p className="text-xs text-gray-500">{t.d}</p>
              </button>
            ))}
          </div>
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Tell me about these contacts</label>
          <textarea value={userContext} onChange={e => setUserContext(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g., Customers I sold at CertaPro 2020-2024. Mostly exterior jobs in Vienna/McLean." />
        </div>
      </div>
      <button onClick={processUpload} className="mt-4 bg-green-600 text-white px-6 py-2 rounded-lg text-sm font-medium w-full">Import {csvData.length} Contacts →</button>
    </div>
  );

  if (step === 4) return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">⏳</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Importing...</h2>
      <p className="text-sm text-gray-500 mb-4">{progress.processed} of {progress.total}</p>
      <div className="w-full bg-gray-200 rounded-full h-3 max-w-md mx-auto">
        <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${progress.total ? (progress.processed / progress.total * 100) : 0}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-3">{progress.created} new · {progress.updated} updated · {progress.skipped} skipped</p>
    </div>
  );

  return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">✅</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Import Complete!</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-sm mx-auto mt-4 text-sm space-y-2">
        <div className="flex justify-between"><span className="text-gray-500">Total:</span><span>{progress.total}</span></div>
        <div className="flex justify-between"><span className="text-green-600">New:</span><span className="text-green-600">{progress.created}</span></div>
        <div className="flex justify-between"><span className="text-blue-600">Updated:</span><span className="text-blue-600">{progress.updated}</span></div>
        <div className="flex justify-between"><span className="text-gray-400">Skipped:</span><span className="text-gray-400">{progress.skipped}</span></div>
      </div>
      <button onClick={onDone} className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Done →</button>
    </div>
  );
}
