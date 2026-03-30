import { useState, useEffect, useCallback } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists, getContactsByList, getUnsubscribes } from '../lib/contacts';
import { getAllCampaigns, createCampaign, updateCampaign, personalizeEmail } from '../lib/campaigns';

const API = import.meta.env.VITE_API_URL || '';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getAllCampaigns(auth.currentUser.uid);
    setCampaigns(data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (showBuilder) return <CampaignBuilder onDone={() => { setShowBuilder(false); load(); }} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Campaigns</h1>
        <button onClick={() => setShowBuilder(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ New Campaign</button>
      </div>
      {loading ? <p className="text-gray-400 text-center py-10">Loading...</p> : campaigns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">📧</p>
          <p className="text-gray-500">No campaigns yet.</p>
          <button onClick={() => setShowBuilder(true)} className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Create your first campaign</button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-800">{c.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{c.fromName} · {c.audienceCount || 0} contacts · {new Date(c.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${c.status === 'sent' ? 'bg-green-100 text-green-700' : c.status === 'sending' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                  {c.status}
                </span>
              </div>
              {c.stats?.sent > 0 && (
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  <span>Sent: {c.stats.sent}</span>
                  <span>Delivered: {c.stats.delivered}</span>
                  <span>Failed: {c.stats.failed}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignBuilder({ onDone }) {
  const [step, setStep] = useState(1); // 1=audience, 2=sender, 3=content, 4=preview, 5=review gate, 6=sending, 7=done
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [cityFilter, setCityFilter] = useState('');
  const [contacts, setContacts] = useState([]);
  const [audienceContacts, setAudienceContacts] = useState([]);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [sendMethod, setSendMethod] = useState('brevo');
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHTML, setBodyHTML] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [aiGoal, setAiGoal] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [sendProgress, setSendProgress] = useState(null);
  const [sendResults, setSendResults] = useState(null);

  useEffect(() => { getAllLists(auth.currentUser.uid).then(setLists); }, []);

  // Step 1: Select audience
  const selectList = async (listId) => {
    setSelectedListId(listId);
    const list = lists.find(l => l.id === listId);
    setSelectedList(list);
    setCampaignName((list?.name || '') + ' - ' + new Date().toLocaleDateString());
    setFromEmail(list?.defaultSettings?.fromAddress || 'mary@northernstarpainters.com');
    setFromName(list?.defaultSettings?.fromName || 'Mary Johnson');
    setSendMethod(list?.defaultSettings?.sendingMethod || 'brevo');
    const allContacts = await getContactsByList(auth.currentUser.uid, listId);
    const unsubs = await getUnsubscribes(auth.currentUser.uid);
    const filtered = allContacts.filter(c => !c.unsubscribed && !c.bounced && !unsubs.has(c.email));
    setContacts(filtered);
    setAudienceContacts(filtered);
  };

  const applyFilters = () => {
    let result = contacts;
    if (cityFilter) result = result.filter(c => c.address?.city === cityFilter);
    setAudienceContacts(result);
  };

  useEffect(() => { applyFilters(); }, [cityFilter, contacts]);

  // AI generate email
  const generateWithAI = async () => {
    if (!aiGoal.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${API}/api/ai/generate-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: aiGoal,
          persona: selectedList?.aiAnalysis?.persona || selectedList?.userContext || 'Painting customers in Northern Virginia',
          senderName: fromName,
          tone: selectedList?.defaultSettings?.tone || 'professional',
          personalizationFields: ['{FirstName}', '{LastName}', '{City}', '{JobYear}', '{YearsSince}', '{JobType}', '{Address}'],
        }),
      });
      const data = await res.json();
      if (data.subject) setSubject(data.subject);
      if (data.bodyHTML) setBodyHTML(data.bodyHTML);
      if (data.bodyText) setBodyText(data.bodyText);
    } catch (e) {
      alert('AI generation failed: ' + e.message);
    }
    setAiLoading(false);
  };

  // Send campaign
  const sendCampaign = async () => {
    setStep(6);
    setSendProgress({ sent: 0, total: audienceContacts.length });

    const campaignId = await createCampaign(auth.currentUser.uid, {
      name: campaignName, listId: selectedListId, fromAddress: fromEmail, fromName,
      sendingMethod: sendMethod, subject, bodyHTML, bodyText,
      audienceCount: audienceContacts.length, filters: { city: cityFilter || 'all' },
      personalizationFields: ['{FirstName}', '{City}', '{JobYear}', '{YearsSince}'],
    });

    try {
      const res = await fetch(`${API}/api/send/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: sendMethod, fromEmail, fromName, subject, htmlTemplate: bodyHTML, textTemplate: bodyText,
          contacts: audienceContacts,
        }),
      });
      const results = await res.json();
      await updateCampaign(campaignId, { status: 'sent', sentAt: new Date().toISOString(), stats: { sent: results.sent, delivered: results.sent, failed: results.failed, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 } });
      setSendResults(results);
      setStep(7);
    } catch (e) {
      alert('Send failed: ' + e.message);
      setStep(5);
    }
  };

  const cities = [...new Set(contacts.map(c => c.address?.city).filter(Boolean))].sort();
  const sampleContact = audienceContacts[0] || { firstName: 'Sarah', lastName: 'Johnson', address: { city: 'Vienna' }, email: 'example@email.com' };

  // Step 1: Audience
  if (step === 1) return (
    <div>
      <button onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Step 1: Select Audience</h2>
      <div className="space-y-3">
        {lists.map(l => (
          <button key={l.id} onClick={() => { selectList(l.id); setStep(2); }}
            className={`w-full text-left p-4 rounded-xl border transition ${selectedListId === l.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <p className="font-medium text-gray-800">{l.name}</p>
            <p className="text-sm text-gray-500">{l.contactCount || 0} contacts · {l.tier}</p>
          </button>
        ))}
        {lists.length === 0 && <p className="text-gray-500 text-center py-6">Upload a list first.</p>}
      </div>
    </div>
  );

  // Step 2: Sender
  if (step === 2) return (
    <div>
      <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Step 2: Sender & Filters</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
          <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Send From</label>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setFromEmail('amirz@northernstarpainters.com'); setFromName('Amir Zreik'); setSendMethod('titan'); }}
              className={`p-3 rounded-lg border text-left text-sm ${fromEmail.includes('amirz') ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">🤝 Amir Zreik</p><p className="text-xs text-gray-500">Personal (Titan SMTP)</p>
            </button>
            <button onClick={() => { setFromEmail('mary@northernstarpainters.com'); setFromName('Mary Johnson'); setSendMethod('brevo'); }}
              className={`p-3 rounded-lg border text-left text-sm ${fromEmail.includes('mary') ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">📋 Mary Johnson</p><p className="text-xs text-gray-500">Professional (Brevo)</p>
            </button>
          </div>
        </div>
        {cities.length > 0 && (
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Filter by City</label>
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All cities ({contacts.length} contacts)</option>
              {cities.map(c => <option key={c} value={c}>{c} ({contacts.filter(ct => ct.address?.city === c).length})</option>)}
            </select>
          </div>
        )}
        <p className="text-sm font-medium text-blue-600">Audience: {audienceContacts.length} contacts</p>
      </div>
      <button onClick={() => setStep(3)} disabled={audienceContacts.length === 0}
        className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium w-full disabled:opacity-50">Next: Write Email →</button>
    </div>
  );

  // Step 3: Content
  if (step === 3) return (
    <div>
      <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Step 3: Email Content</h2>
      <div className="bg-purple-50 rounded-xl border border-purple-200 p-4 mb-4">
        <p className="text-sm font-medium text-purple-800 mb-2">🤖 AI Assistant</p>
        <textarea value={aiGoal} onChange={e => setAiGoal(e.target.value)} rows={2} placeholder="e.g., Re-engage customers who had exterior painting 5+ years ago. Offer spring special 15% off."
          className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm mb-2" />
        <button onClick={generateWithAI} disabled={aiLoading} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {aiLoading ? '⏳ Generating...' : '✨ Generate with AI'}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Subject Line</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="{FirstName}, Time to Refresh Your {City} Home?" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Email Body (HTML)</label>
          <textarea value={bodyHTML} onChange={e => setBodyHTML(e.target.value)} rows={12} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" placeholder="Write your email here. Use {FirstName}, {City}, {JobYear}, {YearsSince}, {JobType} for personalization." /></div>
        <p className="text-xs text-gray-400">Available fields: {'{FirstName}'} {'{LastName}'} {'{City}'} {'{Address}'} {'{JobYear}'} {'{JobType}'} {'{YearsSince}'}</p>
      </div>
      <button onClick={() => { if (!subject || !bodyHTML) { alert('Subject and body required'); return; } setBodyText(bodyHTML.replace(/<[^>]*>/g, '')); setStep(4); }}
        className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium w-full">Preview →</button>
    </div>
  );

  // Step 4: Preview
  if (step === 4) return (
    <div>
      <button onClick={() => setStep(3)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Step 4: Preview</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="border-b border-gray-100 pb-3 mb-3 text-sm">
          <p><span className="text-gray-500">From:</span> {fromName} &lt;{fromEmail}&gt;</p>
          <p><span className="text-gray-500">To:</span> {sampleContact.firstName} &lt;{sampleContact.email}&gt;</p>
          <p><span className="text-gray-500">Subject:</span> <strong>{personalizeEmail(subject, sampleContact)}</strong></p>
        </div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: personalizeEmail(bodyHTML, sampleContact) }} />
        <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100 text-center">
          Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204 · <span className="underline">Unsubscribe</span>
        </p>
      </div>
      <button onClick={() => setStep(5)} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium w-full">Continue to Review Gate →</button>
    </div>
  );

  // Step 5: REVIEW GATE
  if (step === 5) return (
    <div>
      <button onClick={() => setStep(4)} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center">
        <p className="text-3xl mb-3">⚠️</p>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Review Gate — Confirm Send</h2>
        <p className="text-sm text-gray-600 mb-4">This action will send real emails. Please review carefully.</p>
        <div className="bg-white rounded-lg p-4 text-left text-sm space-y-2 mb-4 max-w-md mx-auto">
          <div className="flex justify-between"><span className="text-gray-500">Campaign:</span><span className="font-medium">{campaignName}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">From:</span><span>{fromName} ({fromEmail})</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Method:</span><span className="uppercase">{sendMethod}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Recipients:</span><span className="font-bold text-red-600">{audienceContacts.length} contacts</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Subject:</span><span>{subject}</span></div>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={() => setStep(4)} className="px-6 py-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">← Edit</button>
          <button onClick={sendCampaign} className="px-6 py-3 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">✓ Confirm & Send</button>
        </div>
      </div>
    </div>
  );

  // Step 6: Sending
  if (step === 6) return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">📤</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Sending...</h2>
      <p className="text-sm text-gray-500">Sending to {sendProgress?.total || 0} contacts via {sendMethod}</p>
      <div className="w-full bg-gray-200 rounded-full h-3 max-w-md mx-auto mt-4">
        <div className="bg-blue-600 h-3 rounded-full animate-pulse" style={{ width: '50%' }} />
      </div>
    </div>
  );

  // Step 7: Done
  return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">✅</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Campaign Sent!</h2>
      {sendResults && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-sm mx-auto mt-4 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-green-600">Sent:</span><span className="font-medium text-green-600">{sendResults.sent}</span></div>
          <div className="flex justify-between"><span className="text-red-500">Failed:</span><span className="font-medium text-red-500">{sendResults.failed}</span></div>
        </div>
      )}
      <button onClick={onDone} className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Done →</button>
    </div>
  );
}
