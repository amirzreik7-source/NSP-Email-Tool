import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllLists, getContactsByList, getUnsubscribes } from '../lib/contacts';
import { createCampaign, updateCampaign } from '../lib/campaigns';

const API = import.meta.env.VITE_API_URL || '';

export default function AICampaign() {
  const [step, setStep] = useState(1); // 1=audience, 2=goal, 3=generating, 4=audit, 5=sample, 6=sending, 7=done
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [cityFilter, setCityFilter] = useState('');
  const [audienceContacts, setAudienceContacts] = useState([]);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [goal, setGoal] = useState('');
  const [generatedEmails, setGeneratedEmails] = useState([]);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [auditResult, setAuditResult] = useState(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [sampleEmails, setSampleEmails] = useState([]);
  const [sendResults, setSendResults] = useState(null);

  useEffect(() => { getAllLists(auth.currentUser.uid).then(setLists); }, []);

  const selectList = async (listId) => {
    setSelectedListId(listId);
    const list = lists.find(l => l.id === listId);
    setSelectedList(list);
    setFromEmail(list?.defaultSettings?.fromAddress || 'mary@northernstarpainters.com');
    setFromName(list?.defaultSettings?.fromName || 'Mary Johnson');
    const allContacts = await getContactsByList(auth.currentUser.uid, listId);
    const unsubs = await getUnsubscribes(auth.currentUser.uid);
    setContacts(allContacts.filter(c => !c.unsubscribed && !c.bounced && !unsubs.has(c.email)));
  };

  useEffect(() => {
    let result = contacts;
    if (cityFilter) result = result.filter(c => c.address?.city === cityFilter);
    setAudienceContacts(result);
  }, [cityFilter, contacts]);

  const cities = [...new Set(contacts.map(c => c.address?.city).filter(Boolean))].sort();

  // Step 3: Generate unique emails for all contacts
  const generateAll = async () => {
    setStep(3);
    const batchSize = 10;
    const all = [];
    setGenProgress({ done: 0, total: audienceContacts.length });

    for (let i = 0; i < audienceContacts.length; i += batchSize) {
      const batch = audienceContacts.slice(i, i + batchSize);
      try {
        const res = await fetch(`${API}/api/ai/generate-unique-emails-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: batch,
            senderName: fromName,
            senderEmail: fromEmail,
            tone: selectedList?.defaultSettings?.tone || 'professional',
            goal,
            listPersona: selectedList?.aiAnalysis?.persona || selectedList?.userContext || '',
          }),
        });
        const data = await res.json();
        all.push(...(data.results || []));
      } catch(e) {
        batch.forEach(c => all.push({ contactId: c.id, email: c.email, status: 'error', error: e.message }));
      }
      setGenProgress({ done: Math.min(i + batchSize, audienceContacts.length), total: audienceContacts.length });
    }

    setGeneratedEmails(all);
    // Run audit
    runAudit(all);
  };

  const runAudit = async (emails) => {
    setStep(4);
    try {
      const auditData = emails.filter(e => e.status === 'ok').map(e => {
        const contact = audienceContacts.find(c => c.id === e.contactId);
        return {
          email: e.email,
          tier: (contact?.lists || []).some(l => l.tier === 'personal') ? 'personal' : 'general',
          subject: e.subject,
          bodyText: e.bodyText,
          bodyHTML: e.bodyHTML,
          jobHistory: contact?.jobHistory,
          city: contact?.address?.city,
        };
      });

      const res = await fetch(`${API}/api/ai/audit-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: auditData,
          campaignSender: fromName,
          campaignTier: selectedList?.tier || 'general',
        }),
      });
      const audit = await res.json();
      setAuditResult(audit);
    } catch(e) {
      setAuditResult({ passed: emails.length, warnings: [], critical: [], summary: 'Audit failed: ' + e.message });
    }
  };

  const startSampleReview = () => {
    const okEmails = generatedEmails.filter(e => e.status === 'ok');
    // Pick 10 random
    const shuffled = [...okEmails].sort(() => Math.random() - 0.5);
    setSampleEmails(shuffled.slice(0, Math.min(10, shuffled.length)));
    setSampleIndex(0);
    setStep(5);
  };

  const regenerateSample = async (idx) => {
    const email = sampleEmails[idx];
    const contact = audienceContacts.find(c => c.id === email.contactId);
    if (!contact) return;

    setSampleEmails(prev => prev.map((e, i) => i === idx ? { ...e, regenerating: true } : e));

    try {
      const res = await fetch(`${API}/api/ai/generate-unique-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, senderName: fromName, senderEmail: fromEmail, tone: selectedList?.defaultSettings?.tone || 'professional', goal, listPersona: selectedList?.aiAnalysis?.persona || '' }),
      });
      const data = await res.json();
      const updated = { ...email, ...data, regenerating: false };
      setSampleEmails(prev => prev.map((e, i) => i === idx ? updated : e));
      // Also update in generatedEmails
      setGeneratedEmails(prev => prev.map(e => e.contactId === email.contactId ? { ...e, ...data } : e));
    } catch(e) {
      setSampleEmails(prev => prev.map((e, i) => i === idx ? { ...e, regenerating: false } : e));
    }
  };

  // Send all emails
  const sendAll = async () => {
    setStep(6);
    const okEmails = generatedEmails.filter(e => e.status === 'ok');
    const campaignId = await createCampaign(auth.currentUser.uid, {
      name: `AI Campaign — ${selectedList?.name || 'Unknown'} — ${new Date().toLocaleDateString()}`,
      listId: selectedListId,
      fromAddress: fromEmail,
      fromName,
      sendingMethod: 'brevo',
      subject: 'Individual AI emails',
      audienceCount: okEmails.length,
      aiGenerated: true,
      individualEmails: true,
    });

    let sent = 0, failed = 0;
    const footer = `<br><br><p style="font-size:11px;color:#999;text-align:center;">Northern Star Painters | 4600 South Four Mile Run Drive, Arlington, VA 22204<br><a href="#" style="color:#999;">Unsubscribe</a></p>`;
    const baseUrl = API || window.location.origin;

    for (const email of okEmails) {
      try {
        // Add tracking pixel and link tracking
        let html = email.bodyHTML || `<p>${email.bodyText}</p>`;
        html += `<img src="${baseUrl}/api/track/open?c=${email.contactId}&cam=${campaignId}" width="1" height="1" style="display:none">`;
        html = html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => `href="${baseUrl}/api/track/click?c=${email.contactId}&cam=${campaignId}&u=${encodeURIComponent(url)}"`);
        html += footer;

        const res = await fetch(`${API}/api/send/brevo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromEmail, fromName, toEmail: email.email, toName: '', subject: email.subject, htmlContent: html, textContent: email.bodyText || '' }),
        });
        if (res.ok) sent++; else failed++;
      } catch(e) { failed++; }
    }

    await updateCampaign(campaignId, {
      status: 'sent',
      sentAt: new Date().toISOString(),
      stats: { sent, delivered: sent, failed, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 },
    });

    setSendResults({ sent, failed, total: okEmails.length });
    setStep(7);
  };

  // Step 1: Audience
  if (step === 1) return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">🤖 AI Campaign — Select Audience</h2>
      <div className="space-y-3">
        {lists.map(l => (
          <button key={l.id} onClick={() => { selectList(l.id); setStep(2); }}
            className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition">
            <p className="font-medium text-gray-800">{l.name}</p>
            <p className="text-sm text-gray-500">{l.contactCount || 0} contacts · {l.tier}</p>
          </button>
        ))}
      </div>
    </div>
  );

  // Step 2: Goal + sender
  if (step === 2) return (
    <div>
      <button onClick={() => setStep(1)} className="text-sm text-gray-500 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">🤖 AI Campaign — Describe Your Goal</h2>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div><label className="block text-sm font-medium text-gray-700 mb-2">Send From</label>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setFromEmail('amirz@northernstarpainters.com'); setFromName('Amir Zreik'); }}
              className={`p-3 rounded-lg border text-left text-sm ${fromEmail.includes('amirz') ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">🤝 Amir Zreik</p><p className="text-xs text-gray-500">Personal</p>
            </button>
            <button onClick={() => { setFromEmail('mary@northernstarpainters.com'); setFromName('Mary Johnson'); }}
              className={`p-3 rounded-lg border text-left text-sm ${fromEmail.includes('mary') ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
              <p className="font-medium">📋 Mary Johnson</p><p className="text-xs text-gray-500">Professional</p>
            </button>
          </div>
        </div>
        {cities.length > 0 && (
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Filter by City</label>
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">All ({contacts.length})</option>
              {cities.map(c => <option key={c} value={c}>{c} ({contacts.filter(ct => ct.address?.city === c).length})</option>)}
            </select>
          </div>
        )}
        <p className="text-sm font-medium text-blue-600">Audience: {audienceContacts.length} contacts</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Goal</label>
          <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="e.g., Re-engage exterior customers from 5+ years ago. Offer spring special 15% off. Mention we serve their specific city." />
        </div>
        <button onClick={generateAll} disabled={!goal.trim() || !audienceContacts.length}
          className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
          🤖 Generate {audienceContacts.length} Unique Emails →
        </button>
      </div>
    </div>
  );

  // Step 3: Generating
  if (step === 3) return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">🤖</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Generating Unique Emails...</h2>
      <p className="text-sm text-gray-500 mb-4">{genProgress.done} of {genProgress.total} contacts</p>
      <div className="w-full bg-gray-200 rounded-full h-3 max-w-md mx-auto">
        <div className="bg-purple-600 h-3 rounded-full transition-all" style={{ width: `${genProgress.total ? (genProgress.done / genProgress.total * 100) : 0}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-3">AI is writing a unique email for each contact based on their individual profile...</p>
    </div>
  );

  // Step 4: Audit results
  if (step === 4) return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">🔍 Pre-Send Audit Results</h2>
      {!auditResult ? (
        <p className="text-gray-400 text-center py-10">Running audit...</p>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-600">{auditResult.summary}</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-green-700">{auditResult.passed || 0}</p><p className="text-xs text-green-600">Passed</p></div>
              <div className="bg-yellow-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-yellow-700">{(auditResult.warnings || []).length}</p><p className="text-xs text-yellow-600">Warnings</p></div>
              <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-2xl font-bold text-red-700">{(auditResult.critical || []).length}</p><p className="text-xs text-red-600">Critical</p></div>
            </div>
          </div>

          {(auditResult.critical || []).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h3 className="font-semibold text-red-800 mb-2">🚨 Critical Issues</h3>
              {auditResult.critical.map((c, i) => <p key={i} className="text-sm text-red-700 mb-1">• {c.email}: {c.issue}</p>)}
            </div>
          )}

          {(auditResult.warnings || []).length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Warnings</h3>
              {auditResult.warnings.map((w, i) => <p key={i} className="text-sm text-yellow-700 mb-1">• {w.email}: {w.issue}</p>)}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={startSampleReview} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">Review 10 Samples →</button>
            <button onClick={() => setStep(2)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Edit</button>
          </div>
        </div>
      )}
    </div>
  );

  // Step 5: Sample review
  if (step === 5 && sampleEmails.length > 0) {
    const current = sampleEmails[sampleIndex];
    const contact = audienceContacts.find(c => c.id === current?.contactId);
    return (
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">📝 Sample Review — {sampleIndex + 1} of {sampleEmails.length}</h2>
        <div className="bg-gray-50 rounded-lg p-3 mb-3 text-sm">
          <span className="font-medium">{contact?.firstName} {contact?.lastName}</span> · {contact?.address?.city || 'Unknown'} · {(contact?.lists || []).map(l => l.tier).join(', ')}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <p className="text-xs text-gray-500 mb-1">Subject:</p>
          <p className="font-medium text-gray-800 mb-3">{current?.subject}</p>
          <p className="text-xs text-gray-500 mb-1">Body:</p>
          <div className="text-sm text-gray-700 prose prose-sm" dangerouslySetInnerHTML={{ __html: current?.bodyHTML || current?.bodyText }} />
        </div>

        <div className="flex gap-3">
          <button onClick={() => { sampleIndex < sampleEmails.length - 1 ? setSampleIndex(sampleIndex + 1) : sendAll(); }}
            className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium">
            {sampleIndex < sampleEmails.length - 1 ? `Looks Good — Next (${sampleIndex + 2}/${sampleEmails.length})` : `✓ All Good — Send ${generatedEmails.filter(e => e.status === 'ok').length} Emails`}
          </button>
          <button onClick={() => regenerateSample(sampleIndex)} disabled={current?.regenerating}
            className="px-4 py-3 border border-orange-300 text-orange-700 rounded-lg text-sm disabled:opacity-50">
            {current?.regenerating ? '...' : '🔄 Regenerate'}
          </button>
        </div>
      </div>
    );
  }

  // Step 6: Sending
  if (step === 6) return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">📤</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Sending Individual Emails...</h2>
      <p className="text-sm text-gray-500">Each contact receives their unique email via Brevo</p>
    </div>
  );

  // Step 7: Done
  return (
    <div className="text-center py-10">
      <p className="text-4xl mb-4">✅</p>
      <h2 className="text-xl font-bold text-gray-800 mb-2">AI Campaign Sent!</h2>
      {sendResults && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-sm mx-auto mt-4 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-green-600">Sent:</span><span className="font-bold text-green-600">{sendResults.sent}</span></div>
          <div className="flex justify-between"><span className="text-red-500">Failed:</span><span className="font-bold text-red-500">{sendResults.failed}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Total:</span><span>{sendResults.total}</span></div>
        </div>
      )}
      <button onClick={() => window.location.href = '/campaigns'} className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Done →</button>
    </div>
  );
}
