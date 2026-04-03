import { useState, useEffect, useCallback } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists, createList, upsertContact, reclassifyContacts } from '../lib/contacts';
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
              <div key={list.id} onClick={() => navigate(`/contacts/${list.id}`)} className={`${tier.bg} ${tier.border} border rounded-xl p-5 cursor-pointer hover:shadow-md transition`}>
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

const API = import.meta.env.VITE_API_URL || '';

function CSVUpload({ onDone }) {
  const [step, setStep] = useState(1); // 1=upload, 2=AI analyzing, 3=review mapping, 4=list details, 5=importing, 6=done
  const [csvData, setCsvData] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [aiNotes, setAiNotes] = useState('');
  const [aiConfidence, setAiConfidence] = useState('');
  const [unmappedCols, setUnmappedCols] = useState([]);
  const [listName, setListName] = useState('');
  const [tier, setTier] = useState('general');
  const [tierReason, setTierReason] = useState('');
  const [userContext, setUserContext] = useState('');
  const [progress, setProgress] = useState({ total: 0, processed: 0, created: 0, updated: 0, skipped: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [hasFullName, setHasFullName] = useState(false);
  const [hasFullAddress, setHasFullAddress] = useState(false);

  const FIELDS = [
    { key: 'email', label: 'Email', required: false },
    { key: 'firstName', label: 'First Name' }, { key: 'lastName', label: 'Last Name' },
    { key: 'phone', label: 'Phone' }, { key: 'street', label: 'Street Address' }, { key: 'city', label: 'City' },
    { key: 'state', label: 'State' }, { key: 'zip', label: 'Zip' }, { key: 'jobType', label: 'Job Type' },
    { key: 'jobDate', label: 'Job Date' }, { key: 'jobValue', label: 'Job Value ($)' },
    { key: 'salesRep', label: 'Sales Rep' }, { key: 'company', label: 'Company' }, { key: 'notes', label: 'Notes' },
  ];

  const handleFile = (file) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) { alert('Please upload a CSV file'); return; }
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (r) => {
        setCsvData(r.data);
        setHeaders(r.meta.fields || []);
        setListName(file.name.replace(/\.(csv|txt)$/i, ''));
        setStep(2); // Go to AI analysis

        // Send to AI for smart mapping
        try {
          const res = await fetch(`${API}/api/ai/map-csv-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headers: r.meta.fields, sampleRows: r.data.slice(0, 5) }),
          });
          const data = await res.json();
          if (data.mapping) {
            // Clean nulls from mapping
            const cleanMapping = {};
            for (const [key, val] of Object.entries(data.mapping)) {
              if (val && val !== 'null' && r.meta.fields.includes(val)) cleanMapping[key] = val;
            }
            // Check if firstName and lastName point to same col (full name scenario)
            if (cleanMapping.firstName && cleanMapping.firstName === cleanMapping.lastName) {
              setHasFullName(true);
            }
            // Check if street contains full address
            if (cleanMapping.street && !cleanMapping.city) {
              setHasFullAddress(true);
            }
            setMapping(cleanMapping);
            setAiNotes(data.notes || '');
            setAiConfidence(data.confidence || 'medium');
            setUnmappedCols(data.unmappedColumns || []);
            if (data.suggestedTier) { setTier(data.suggestedTier); setTierReason(data.tierReason || ''); }
          }
        } catch (e) {
          // Fallback to basic auto-mapping
          const auto = {};
          (r.meta.fields || []).forEach(h => {
            const l = h.toLowerCase().replace(/[^a-z]/g, '');
            if (l.includes('email') || l.includes('mail')) auto.email = h;
            else if (l === 'firstname' || l === 'first' || l === 'fname') auto.firstName = h;
            else if (l === 'lastname' || l === 'last' || l === 'lname') auto.lastName = h;
            else if (l.includes('phone') || l.includes('mobile') || l.includes('cell')) auto.phone = h;
            else if (l.includes('street') || l.includes('address') || l.includes('addr')) auto.street = h;
            else if (l === 'city' || l === 'town') auto.city = h;
            else if (l === 'state' || l === 'st') auto.state = h;
            else if (l === 'zip' || l === 'zipcode' || l === 'postal') auto.zip = h;
            else if (l.includes('job') && l.includes('type')) auto.jobType = h;
            else if (l.includes('date')) auto.jobDate = h;
            else if (l.includes('value') || l.includes('amount') || l.includes('price')) auto.jobValue = h;
          });
          setMapping(auto);
          setAiNotes('AI mapping unavailable — used basic auto-detection.');
          setAiConfidence('low');
        }
        setStep(3);
      },
    });
  };

  const parseFullName = (fullName) => {
    if (!fullName) return { first: '', last: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    // Handle "Last, First" format
    if (parts[0].endsWith(',')) return { first: parts.slice(1).join(' '), last: parts[0].replace(',', '') };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  };

  const parseFullAddress = (addr) => {
    if (!addr) return { street: '', city: '', state: '', zip: '' };
    // Try to parse "123 Main St, Vienna, VA 22180" format
    const parts = addr.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      const stateZip = parts[parts.length - 1].trim().split(/\s+/);
      return { street: parts[0], city: parts[1], state: stateZip[0] || '', zip: stateZip[1] || '' };
    }
    if (parts.length === 2) {
      return { street: parts[0], city: parts[1], state: '', zip: '' };
    }
    return { street: addr, city: '', state: '', zip: '' };
  };

  const [importErrors, setImportErrors] = useState([]);
  const [fuzzyMatches, setFuzzyMatches] = useState([]);
  const [reviewingDupes, setReviewingDupes] = useState(false);
  const [dupeIndex, setDupeIndex] = useState(0);

  const processUpload = async () => {
    setStep(5);
    setImportErrors([]);
    setFuzzyMatches([]);
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
    let created = 0, updated = 0, skipped = 0, failed = 0;
    const errors = [];
    const possibleDupes = [];

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];

      // Handle full name splitting
      let firstName = row[mapping.firstName] || '';
      let lastName = row[mapping.lastName] || '';
      if (hasFullName && mapping.firstName) {
        const parsed = parseFullName(row[mapping.firstName]);
        firstName = parsed.first;
        lastName = parsed.last;
      }

      // Handle full address parsing
      let address = { street: row[mapping.street] || '', city: row[mapping.city] || '', state: row[mapping.state] || '', zip: row[mapping.zip] || '' };
      if (hasFullAddress && mapping.street && !mapping.city) {
        const parsed = parseFullAddress(row[mapping.street]);
        address = parsed;
      }

      // Clean phone — strip non-digits
      let phone = row[mapping.phone] || '';
      phone = phone.replace(/[^0-9+]/g, '');

      // Clean job value — strip $ and commas
      let jobValue = 0;
      if (mapping.jobValue && row[mapping.jobValue]) {
        jobValue = parseFloat(String(row[mapping.jobValue]).replace(/[$,]/g, '')) || 0;
      }

      const contactData = {
        email: (row[mapping.email] || '').trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone,
        address,
        tags: [address.city, row[mapping.jobType]].filter(Boolean),
        jobHistory: (row[mapping.jobType] || row[mapping.jobDate] || row[mapping.jobValue]) ? [{
          company: row[mapping.company] || (tier === 'personal' ? 'CertaPro' : ''),
          jobDate: row[mapping.jobDate] || '',
          jobType: row[mapping.jobType] || '',
          jobValue,
          salesRep: row[mapping.salesRep] || (tier === 'personal' ? 'Amir' : ''),
        }] : [],
      };

      // Skip rows with no email AND no name — truly empty
      if (!contactData.email && !contactData.firstName && !contactData.lastName) {
        skipped++;
        errors.push({ row: i + 1, reason: 'Empty row — no email, no name' });
        if ((i + 1) % 10 === 0 || i === csvData.length - 1) setProgress({ total: csvData.length, processed: i + 1, created, updated, skipped, failed });
        continue;
      }

      // If no email but has name, still import (for fuzzy matching later)
      if (!contactData.email) {
        contactData.email = `no-email-${Date.now()}-${i}@placeholder.local`;
        errors.push({ row: i + 1, reason: `No email — saved as placeholder (${contactData.firstName} ${contactData.lastName})` });
      }

      try {
        const r = await upsertContact(userId, contactData, listInfo);
        if (r.status === 'created') created++;
        else if (r.status === 'updated') updated++;
        else { skipped++; errors.push({ row: i + 1, reason: r.reason || 'Skipped' }); }
      } catch (e) {
        failed++;
        errors.push({ row: i + 1, reason: `Save failed: ${e.message}` });
      }
      if ((i + 1) % 10 === 0 || i === csvData.length - 1) setProgress({ total: csvData.length, processed: i + 1, created, updated, skipped, failed });
    }

    // Run fuzzy duplicate detection
    try {
      const res = await fetch(`${API}/api/contacts/fuzzy-match`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, listId }),
      });
      const data = await res.json();
      if (data.possibleDuplicates?.length > 0) {
        setFuzzyMatches(data.possibleDuplicates);
      }
    } catch (e) { console.error('Fuzzy match error:', e); }

    // Run cross-list reclassification
    try {
      const reclassReport = await reclassifyContacts(userId, listId);
      setProgress(prev => ({ ...prev, reclassified: reclassReport.reclassified?.length || 0, merged: reclassReport.merged || 0 }));
    } catch(e) { console.error('Reclassification error:', e); }

    // Trigger background geocoding
    try {
      fetch(`${API}/api/contacts/geocode-batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch (e) {}

    setImportErrors(errors);
    setStep(6);
  };

  // Step 1: Upload
  if (step === 1) return (
    <div>
      <button onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back to Lists</button>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Upload CSV</h2>
      <p className="text-sm text-gray-500 mb-4">Drop any CSV file — AI will figure out the columns automatically.</p>
      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}>
        <p className="text-4xl mb-3">📁</p>
        <p className="text-gray-600 font-medium">Drag & drop your CSV here</p>
        <p className="text-xs text-gray-400 mt-1">Any format — we'll auto-detect the fields</p>
        <label className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm cursor-pointer hover:bg-blue-700">
          Choose File<input type="file" accept=".csv,.txt" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </label>
      </div>
    </div>
  );

  // Step 2: AI analyzing
  if (step === 2) return (
    <div className="text-center py-16">
      <p className="text-4xl mb-4">🤖</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">AI Reading Your CSV...</h2>
      <p className="text-sm text-gray-500">Analyzing {headers.length} columns and {csvData?.length || 0} rows</p>
      <div className="mt-4 flex justify-center">
        <div className="flex gap-1">
          <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );

  // Step 3: Review AI mapping
  if (step === 3) return (
    <div>
      <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Upload different file</button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Review Field Mapping</h2>
          <p className="text-sm text-gray-500">{csvData.length} rows · {headers.length} columns detected</p>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          aiConfidence === 'high' ? 'bg-green-100 text-green-700' :
          aiConfidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
          'bg-red-100 text-red-700'
        }`}>
          AI confidence: {aiConfidence}
        </span>
      </div>

      {aiNotes && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
          <p className="text-sm text-blue-800">🤖 {aiNotes}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        {FIELDS.map(f => (
          <div key={f.key} className="flex items-center gap-3">
            <label className="w-36 text-sm font-medium text-gray-700">{f.label}</label>
            <select value={mapping[f.key] || ''} onChange={e => setMapping({ ...mapping, [f.key]: e.target.value })}
              className={`flex-1 border rounded-lg px-3 py-2 text-sm ${mapping[f.key] ? 'border-green-300 bg-green-50' : 'border-gray-300'}`}>
              <option value="">— skip —</option>
              {headers.map(h => <option key={h} value={h}>{h} {csvData[0]?.[h] ? `(e.g., "${String(csvData[0][h]).substring(0, 30)}")` : ''}</option>)}
            </select>
            {mapping[f.key] && <span className="text-green-500 text-sm">✓</span>}
          </div>
        ))}
      </div>

      {/* Preview first 3 rows */}
      <div className="mt-4 bg-gray-50 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-2">Preview (first 3 contacts)</h3>
        <div className="space-y-2">
          {csvData.slice(0, 3).map((row, i) => {
            let fn = row[mapping.firstName] || '';
            let ln = row[mapping.lastName] || '';
            if (hasFullName && mapping.firstName) { const p = parseFullName(fn); fn = p.first; ln = p.last; }
            return (
              <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 text-sm flex gap-4">
                <span className="font-medium text-gray-800">{fn} {ln}</span>
                <span className="text-gray-500">{row[mapping.email] || 'no email'}</span>
                <span className="text-gray-400">{row[mapping.city] || row[mapping.street] || ''}</span>
                {row[mapping.jobType] && <span className="text-purple-600">{row[mapping.jobType]}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {unmappedCols.length > 0 && (
        <p className="text-xs text-gray-400 mt-3">Unmapped columns: {unmappedCols.join(', ')}</p>
      )}

      <button onClick={() => setStep(4)} className="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg text-sm font-medium w-full">
        Looks Good → Set List Details
      </button>
    </div>
  );

  // Step 4: List details
  if (step === 4) return (
    <div>
      <button onClick={() => setStep(3)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back to Mapping</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">List Details</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">List Name</label>
          <input type="text" value={listName} onChange={e => setListName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Contact Type</label>
          {tierReason && <p className="text-xs text-blue-600 mb-2">🤖 AI suggests: {tierReason}</p>}
          <div className="grid grid-cols-3 gap-3">
            {[
              { v: 'general', i: '📋', l: 'General / Cold', d: "Don't know Amir" },
              { v: 'personal', i: '🤝', l: 'Personal', d: 'Know Amir personally' },
              { v: 'realtime', i: '⚡', l: 'Real-time', d: 'Current prospects' },
            ].map(t => (
              <button key={t.v} onClick={() => setTier(t.v)} className={`p-3 rounded-lg border text-left text-sm ${tier === t.v ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <p>{t.i}</p><p className="font-medium text-gray-800 mt-1">{t.l}</p><p className="text-xs text-gray-500">{t.d}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tell me about these contacts</label>
          <textarea value={userContext} onChange={e => setUserContext(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g., Customers I sold at CertaPro 2020-2024. Mostly exterior jobs in Vienna/McLean." />
        </div>
      </div>
      <button onClick={processUpload} className="mt-4 bg-green-600 text-white px-6 py-3 rounded-lg text-sm font-medium w-full">
        Import {csvData.length} Contacts →
      </button>
    </div>
  );

  // Step 5: Importing
  if (step === 5) return (
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

  // Duplicate review handler
  const resolveDupe = async (action) => {
    const dupe = fuzzyMatches[dupeIndex];
    if (!dupe) return;
    if (action === 'merge') {
      try {
        await fetch(`${API}/api/contacts/merge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepId: dupe.existing.id, mergeId: dupe.new.id }),
        });
      } catch (e) { console.error('Merge error:', e); }
    }
    if (dupeIndex < fuzzyMatches.length - 1) setDupeIndex(dupeIndex + 1);
    else setReviewingDupes(false);
  };

  // Duplicate review screen
  if (reviewingDupes && fuzzyMatches.length > 0) {
    const dupe = fuzzyMatches[dupeIndex];
    return (
      <div className="max-w-2xl mx-auto py-6">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Review Possible Duplicates</h2>
        <p className="text-sm text-gray-500 mb-4">{dupeIndex + 1} of {fuzzyMatches.length} — Are these the same person?</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-2">Existing Contact</p>
            <p className="font-medium">{dupe.existing.firstName} {dupe.existing.lastName}</p>
            <p className="text-sm text-gray-500">{dupe.existing.email}</p>
            <p className="text-sm text-gray-500">{dupe.existing.address?.city || ''}</p>
            <p className="text-xs text-gray-400 mt-1">Lists: {(dupe.existing.lists || []).map(l => l.listName).join(', ')}</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <p className="text-xs text-blue-600 mb-2">New Import</p>
            <p className="font-medium">{dupe.new.firstName} {dupe.new.lastName}</p>
            <p className="text-sm text-gray-500">{dupe.new.email}</p>
            <p className="text-sm text-gray-500">{dupe.new.address?.city || ''}</p>
            <p className="text-xs text-blue-500 mt-1">Confidence: {Math.round((dupe.confidence || 0) * 100)}%</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => resolveDupe('merge')} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">Yes — Merge</button>
          <button onClick={() => resolveDupe('keep')} className="flex-1 border border-gray-300 py-2 rounded-lg text-sm">No — Keep Separate</button>
        </div>
      </div>
    );
  }

  // Step 6: Done
  return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">✅</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Import Complete!</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-md mx-auto mt-4 text-sm space-y-2">
        <div className="flex justify-between"><span className="text-gray-500">Total in file:</span><span>{progress.total}</span></div>
        <div className="flex justify-between"><span className="text-green-600">New contacts saved:</span><span className="text-green-600">{progress.created}</span></div>
        <div className="flex justify-between"><span className="text-blue-600">Exact matches merged (same email):</span><span className="text-blue-600">{progress.updated}</span></div>
        {progress.failed > 0 && <div className="flex justify-between"><span className="text-red-600">Failed to save:</span><span className="text-red-600">{progress.failed}</span></div>}
        <div className="flex justify-between"><span className="text-gray-400">Skipped:</span><span className="text-gray-400">{progress.skipped}</span></div>
        {fuzzyMatches.length > 0 && (
          <div className="flex justify-between"><span className="text-orange-600">Possible duplicates found:</span><span className="text-orange-600">{fuzzyMatches.length}</span></div>
        )}
        {(progress.reclassified > 0 || progress.merged > 0) && (
          <>
            <hr className="my-2" />
            <p className="text-xs font-medium text-gray-700">Cross-List Intelligence:</p>
            {progress.reclassified > 0 && <div className="flex justify-between"><span className="text-purple-600">Tier upgraded:</span><span className="text-purple-600">{progress.reclassified}</span></div>}
            {progress.merged > 0 && <div className="flex justify-between"><span className="text-indigo-600">Multi-list contacts:</span><span className="text-indigo-600">{progress.merged}</span></div>}
          </>
        )}
      </div>

      {/* Import errors / details */}
      {importErrors.length > 0 && (
        <details className="mt-4 max-w-md mx-auto text-left">
          <summary className="text-xs text-gray-500 cursor-pointer">View {importErrors.length} import details</summary>
          <div className="bg-gray-50 rounded-lg p-3 mt-2 max-h-40 overflow-y-auto text-xs space-y-1">
            {importErrors.map((e, i) => <p key={i} className="text-gray-500">Row {e.row}: {e.reason}</p>)}
          </div>
        </details>
      )}

      <div className="flex gap-3 justify-center mt-6">
        {fuzzyMatches.length > 0 && (
          <button onClick={() => { setReviewingDupes(true); setDupeIndex(0); }} className="bg-orange-600 text-white px-6 py-2 rounded-lg text-sm font-medium">
            Review {fuzzyMatches.length} Duplicates
          </button>
        )}
        <button onClick={onDone} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Done →</button>
      </div>
    </div>
  );
}
