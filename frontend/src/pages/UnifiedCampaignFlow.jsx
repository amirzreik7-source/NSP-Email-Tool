import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { getAllLists, getAllContacts, getContactsByList, getUnsubscribes } from '../lib/contacts';
import { createCampaign, updateCampaign } from '../lib/campaigns';

const API = import.meta.env.VITE_API_URL || '';

export default function UnifiedCampaignFlow() {
  const { draftId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [selectedList, setSelectedList] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [cityFilter, setCityFilter] = useState('');
  const [openerFilter, setOpenerFilter] = useState('all');
  const [audienceContacts, setAudienceContacts] = useState([]);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');

  // Audience method
  const [audienceMethod, setAudienceMethod] = useState('list'); // list, nearby, priority, ai

  // Exclusion rules
  const [exclusions, setExclusions] = useState([]);
  // Each: { type: 'list'|'city'|'engagement'|'contact'|'recentDays', value: string|number, label: string, excludedCount: 0 }

  // Nearby search
  const [nearbyAddress, setNearbyAddress] = useState('');
  const [nearbyRadius, setNearbyRadius] = useState(0.5);
  const [nearbyResults, setNearbyResults] = useState(null);
  const [nearbySearching, setNearbySearching] = useState(false);

  // Priority filter
  const [minStormScore, setMinStormScore] = useState(70);

  // Inline strategy chat
  const [strategyMessages, setStrategyMessages] = useState([]);
  const [strategyInput, setStrategyInput] = useState('');
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyBrief, setStrategyBrief] = useState(null);

  // Campaign Brief state
  const [brief, setBrief] = useState({
    subjectStrategy: 'personalize-city', // same-all, personalize-name, personalize-city, fully-unique
    subjectTemplate: '',
    contentDirection: '',
    mustInclude: { address: false, yearsSince: false, paintColor: false, weather: false, seasonal: false },
    mustNotInclude: { discounts: false, dearValued: true, hardCta: false, images: false },
    tone: 'casual-personal',
    length: 'medium',
    ctaType: 'none', // none, link, button
    ctaText: '',
    ctaUrl: '',
  });

  // 3-sample preview state
  const [quickSamples, setQuickSamples] = useState([]);
  const [quickSampleLoading, setQuickSampleLoading] = useState(false);

  // Full generation state
  const [generatedEmails, setGeneratedEmails] = useState([]);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [auditResult, setAuditResult] = useState(null);
  const [sampleEmails, setSampleEmails] = useState([]);
  const [sampleIndex, setSampleIndex] = useState(0);

  // Design + tracking
  const [designStyle, setDesignStyle] = useState('personal');
  const [trackingConfig, setTrackingConfig] = useState({ uniqueLinksEnabled: true, openPixelEnabled: true });

  // Send
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState(null);

  // Live preview
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewMode, setPreviewMode] = useState('desktop');

  const strategyContext = location.state?.strategyContext || '';
  const preselectedListId = location.state?.listId || '';

  useEffect(() => { loadInitialData(); }, []);
  useEffect(() => {
    let result = audienceMethod === 'nearby' ? (nearbyResults?.nearby || []) :
                 audienceMethod === 'priority' ? contacts.filter(c => (c.stormScore?.score || 0) >= minStormScore) :
                 contacts;
    if (cityFilter) result = result.filter(c => c.address?.city === cityFilter);
    if (openerFilter === 'non-openers') result = result.filter(c => !c.engagement?.totalOpens);
    if (openerFilter === 'openers') result = result.filter(c => c.engagement?.totalOpens > 0);

    // Apply exclusions
    for (const ex of exclusions) {
      if (ex.type === 'list') result = result.filter(c => !(c.lists || []).some(l => l.listId === ex.value));
      else if (ex.type === 'city') result = result.filter(c => c.address?.city !== ex.value);
      else if (ex.type === 'engagement') result = result.filter(c => (c.engagement?.totalOpens || 0) > 0); // exclude non-openers
      else if (ex.type === 'contact') result = result.filter(c => c.id !== ex.value);
    }
    setAudienceContacts(result);
  }, [cityFilter, openerFilter, contacts, exclusions, audienceMethod, nearbyResults, minStormScore]);

  // Pre-fill brief from strategy context if available
  useEffect(() => {
    if (strategyContext) {
      setBrief(prev => ({ ...prev, contentDirection: strategyContext }));
    }
  }, [strategyContext]);

  const loadInitialData = async () => {
    const uid = auth.currentUser.uid;
    const allLists = await getAllLists(uid);
    setLists(allLists);
    try {
      const ts = await fetch(`${API}/api/tracking/settings`).then(r => r.json());
      setTrackingConfig({ uniqueLinksEnabled: ts.uniqueLinksEnabled, openPixelEnabled: ts.openPixelEnabled });
    } catch (e) {}
    if (preselectedListId) {
      const list = allLists.find(l => l.id === preselectedListId);
      if (list) selectList(preselectedListId);
    }
    // Load all contacts for priority/nearby modes
    const allContacts = await getAllContacts(uid);
    if (audienceMethod === 'priority') setContacts(allContacts);
  };

  // Nearby search
  const searchNearby = async () => {
    if (!nearbyAddress.trim()) return;
    setNearbySearching(true);
    try {
      const res = await fetch(`${API}/api/contacts/nearby`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: nearbyAddress, radiusMiles: nearbyRadius, userId: auth.currentUser.uid }),
      });
      const data = await res.json();
      setNearbyResults(data);
      if (data.nearby?.length && !fromName) {
        setFromEmail('amirz@northernstarpainters.com');
        setFromName('Amir Zreik');
      }
    } catch (e) { setNearbyResults({ nearby: [], error: e.message }); }
    setNearbySearching(false);
  };

  // Load all contacts for priority mode
  const loadAllForPriority = async () => {
    const all = await getAllContacts(auth.currentUser.uid);
    setContacts(all);
    if (!fromName) { setFromEmail('amirz@northernstarpainters.com'); setFromName('Amir Zreik'); }
  };

  // Inline strategy chat
  const sendStrategyMessage = async () => {
    if (!strategyInput.trim() || strategyLoading) return;
    const msg = strategyInput.trim();
    setStrategyInput('');
    const newMsgs = [...strategyMessages, { role: 'user', content: msg }];
    setStrategyMessages(newMsgs);
    setStrategyLoading(true);
    try {
      const res = await fetch(`${API}/api/strategy/chat-with-brief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: auth.currentUser.uid, messages: newMsgs.map(m => ({ role: m.role, content: m.content })), conversationId: 'inline_' + Date.now() }),
      });
      const data = await res.json();
      setStrategyMessages([...newMsgs, { role: 'assistant', content: data.response }]);
      if (data.brief) setStrategyBrief(data.brief);
    } catch (e) {
      setStrategyMessages([...newMsgs, { role: 'assistant', content: 'Having trouble connecting. Try again.' }]);
    }
    setStrategyLoading(false);
  };

  // Apply strategy brief to campaign brief form
  const applyStrategyBrief = () => {
    if (!strategyBrief) return;
    const b = strategyBrief;
    setBrief(prev => ({
      ...prev,
      subjectStrategy: b.subjectStrategy || prev.subjectStrategy,
      subjectTemplate: b.subjectTemplate || prev.subjectTemplate,
      contentDirection: b.contentDirection || prev.contentDirection,
      mustInclude: b.mustInclude ? { ...prev.mustInclude, ...Object.fromEntries((b.mustInclude || []).map(k => [k, true])) } : prev.mustInclude,
      mustNotInclude: b.mustExclude ? { ...prev.mustNotInclude, ...Object.fromEntries((b.mustExclude || []).map(k => [k, true])) } : prev.mustNotInclude,
      tone: b.tone || prev.tone,
      length: b.length || prev.length,
    }));
    setStep(2);
  };

  // Add exclusion rule
  const addExclusion = (type, value, label) => {
    if (exclusions.some(e => e.type === type && e.value === value)) return;
    setExclusions([...exclusions, { type, value, label }]);
  };
  const removeExclusion = (idx) => setExclusions(exclusions.filter((_, i) => i !== idx));

  const [listLoading, setListLoading] = useState(false);

  const selectList = async (listId) => {
    setSelectedListId(listId);
    setListLoading(true);
    const list = lists.find(l => l.id === listId);
    setSelectedList(list);
    setFromEmail(list?.defaultSettings?.fromAddress || (list?.tier === 'personal' ? 'amirz@northernstarpainters.com' : 'mary@northernstarpainters.com'));
    setFromName(list?.defaultSettings?.fromName || (list?.tier === 'personal' ? 'Amir Zreik' : 'Mary Johnson'));
    setDesignStyle(list?.tier === 'personal' ? 'personal' : 'soft-branded');
    const uid = auth.currentUser.uid;
    try {
      const allContacts = await getAllContacts(uid);
      // Filter to contacts in this list
      let listContacts = allContacts.filter(c => c.lists?.some(l => l.listId === listId));
      // If no contacts match by listId, try matching by listName as fallback
      if (listContacts.length === 0 && list?.name) {
        listContacts = allContacts.filter(c => c.lists?.some(l => l.listName === list.name));
      }
      let unsubs = new Set();
      try { unsubs = await getUnsubscribes(uid); } catch (e) { console.error('Unsubscribes fetch failed:', e); }
      const filtered = listContacts.filter(c => !c.unsubscribed && !c.bounced && !unsubs.has(c.email));
      setContacts(filtered);
    } catch (e) {
      console.error('Error loading contacts for list:', e);
      setContacts([]);
    }
    setListLoading(false);
  };

  const cities = [...new Set(contacts.map(c => c.address?.city).filter(Boolean))].sort();

  // Build brief instructions string for AI
  const buildBriefInstructions = () => {
    const parts = [];
    parts.push(`SUBJECT LINE: ${
      brief.subjectStrategy === 'same-all' ? 'Use the same subject for all contacts' :
      brief.subjectStrategy === 'personalize-name' ? 'Personalize subject with first name' :
      brief.subjectStrategy === 'personalize-city' ? 'Personalize subject with first name and city' :
      'Write a fully unique subject per contact'
    }${brief.subjectTemplate ? `. Template: "${brief.subjectTemplate}"` : ''}`);

    if (brief.contentDirection) parts.push(`CONTENT DIRECTION: ${brief.contentDirection}`);

    const includes = Object.entries(brief.mustInclude).filter(([, v]) => v).map(([k]) =>
      k === 'address' ? 'Reference their property address' :
      k === 'yearsSince' ? 'Mention years since their last job' :
      k === 'paintColor' ? 'Mention specific paint color if on file' :
      k === 'weather' ? 'Reference current weather/painting conditions' :
      'Add seasonal urgency'
    );
    if (includes.length) parts.push(`MUST INCLUDE: ${includes.join('. ')}`);

    const excludes = Object.entries(brief.mustNotInclude).filter(([, v]) => v).map(([k]) =>
      k === 'discounts' ? 'No discounts or offers' :
      k === 'dearValued' ? 'No "Dear valued customer"' :
      k === 'hardCta' ? 'No hard CTA or pushy buttons' :
      'No images'
    );
    if (excludes.length) parts.push(`MUST NOT INCLUDE: ${excludes.join('. ')}`);

    parts.push(`TONE: ${
      brief.tone === 'casual-personal' ? 'Casual and personal, like texting a friend about business' :
      brief.tone === 'professional-warm' ? 'Professional but warm, not corporate' :
      brief.tone === 'friendly-checkin' ? 'Friendly check-in, not salesy' :
      'Urgent but not pushy'
    }`);

    parts.push(`LENGTH: ${
      brief.length === 'short' ? 'Under 100 words' :
      brief.length === 'medium' ? 'Under 150 words' :
      'Under 200 words'
    }`);

    if (brief.ctaType === 'link' && brief.ctaUrl) {
      parts.push(`CALL TO ACTION: Include a text link to ${brief.ctaUrl} naturally in the email. Make it feel organic, not salesy.`);
    } else if (brief.ctaType === 'button' && brief.ctaUrl) {
      parts.push(`CALL TO ACTION: Include "${brief.ctaText || 'Learn More'}" as a clear call to action linking to ${brief.ctaUrl}.`);
    }

    return parts.join('\n');
  };

  // Generate 3 quick samples
  const generate3Samples = async () => {
    setQuickSampleLoading(true);
    setQuickSamples([]);
    const sampleContacts = [...audienceContacts].sort(() => Math.random() - 0.5).slice(0, 3);
    const briefText = buildBriefInstructions();
    const samples = [];

    for (const contact of sampleContacts) {
      try {
        const res = await fetch(`${API}/api/ai/generate-unique-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact, senderName: fromName, senderEmail: fromEmail,
            tone: brief.tone, goal: briefText,
            listPersona: selectedList?.aiAnalysis?.persona || selectedList?.userContext || '',
          }),
        });
        const data = await res.json();
        samples.push({ contact, ...data, status: 'ok' });
      } catch (e) {
        samples.push({ contact, status: 'error', error: e.message });
      }
    }
    setQuickSamples(samples);
    setQuickSampleLoading(false);
  };

  // Generate all emails
  const generateAll = async () => {
    setStep(4);
    setGenProgress({ done: 0, total: audienceContacts.length });
    const briefText = buildBriefInstructions();
    const all = [];
    const batchSize = 10;

    for (let i = 0; i < audienceContacts.length; i += batchSize) {
      const batch = audienceContacts.slice(i, i + batchSize);
      try {
        const res = await fetch(`${API}/api/ai/generate-unique-emails-batch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: batch, senderName: fromName, senderEmail: fromEmail,
            tone: brief.tone, goal: briefText,
            listPersona: selectedList?.aiAnalysis?.persona || selectedList?.userContext || '',
          }),
        });
        const data = await res.json();
        all.push(...(data.results || []));
      } catch (e) {
        batch.forEach(c => all.push({ contactId: c.id, email: c.email, status: 'error', error: e.message }));
      }
      setGenProgress({ done: Math.min(i + batchSize, audienceContacts.length), total: audienceContacts.length });
    }
    setGeneratedEmails(all);

    // Auto audit
    try {
      const auditData = all.filter(e => e.status === 'ok').map(e => {
        const contact = audienceContacts.find(c => c.id === e.contactId);
        return { email: e.email, tier: selectedList?.tier || 'general', subject: e.subject, bodyText: e.bodyText, bodyHTML: e.bodyHTML, city: contact?.address?.city };
      });
      const auditRes = await fetch(`${API}/api/ai/audit-emails`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: auditData, campaignSender: fromName, campaignTier: selectedList?.tier || 'general' }),
      });
      setAuditResult(await auditRes.json());
    } catch (e) { setAuditResult({ passed: all.length, warnings: [], critical: [], summary: 'Audit unavailable' }); }

    setStep(5);
  };

  // Prepare one email with style + tracking (reusable for send and test)
  const prepareEmail = async (email, campaignId) => {
    const bodyHtml = email.bodyHTML || `<p>${email.bodyText}</p>`;
    const res = await fetch(`${API}/api/email/prepare`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bodyHtml, style: designStyle, fromName, fromEmail,
        contactId: email.contactId, campaignId,
        senderProfile: null, // backend falls back to defaults based on fromName
        trackingOverrides: trackingConfig,
      }),
    });
    return (await res.json()).html;
  };

  // Send test email
  const [testEmails, setTestEmails] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const sendTestEmail = async () => {
    if (!testEmails.trim()) return;
    setTestSending(true);
    setTestResult(null);
    const sample = sampleEmails[sampleIndex] || generatedEmails.find(e => e.status === 'ok');
    if (!sample) { setTestSending(false); setTestResult({ error: 'No sample email to send' }); return; }

    try {
      const html = await prepareEmail(sample, 'test_' + Date.now());
      const res = await fetch(`${API}/api/send/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toEmails: testEmails.split(',').map(e => e.trim()).filter(Boolean).slice(0, 3),
          fromEmail, fromName, subject: sample.subject, html, textContent: sample.bodyText || '',
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) { setTestResult({ error: e.message }); }
    setTestSending(false);
  };

  // Send campaign
  const sendCampaign = async () => {
    setSending(true);
    const uid = auth.currentUser.uid;
    const okEmails = generatedEmails.filter(e => e.status === 'ok');
    const campaignId = await createCampaign(uid, {
      name: `${selectedList?.name || 'Campaign'} — ${new Date().toLocaleDateString()}`,
      listId: selectedListId, fromAddress: fromEmail, fromName,
      sendingMethod: 'brevo', subject: brief.subjectTemplate || 'AI generated',
      audienceCount: okEmails.length, aiGenerated: true, individualEmails: true, designStyle,
    });

    let sent = 0, failed = 0;
    const deliveries = [];

    for (const email of okEmails) {
      try {
        const html = await prepareEmail(email, campaignId);
        const res = await fetch(`${API}/api/send/brevo`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromEmail, fromName, toEmail: email.email, toName: '', subject: email.subject, htmlContent: html, textContent: email.bodyText || '' }),
        });
        if (res.ok) {
          sent++;
          deliveries.push({ contactId: email.contactId, campaignId, campaignName: selectedList?.name || 'Campaign', status: 'sent' });
        } else {
          failed++;
          deliveries.push({ contactId: email.contactId, campaignId, campaignName: selectedList?.name || 'Campaign', status: 'failed' });
        }
      } catch (e) {
        failed++;
        deliveries.push({ contactId: email.contactId, campaignId, campaignName: selectedList?.name || 'Campaign', status: 'failed' });
      }
    }

    // Log all deliveries
    try {
      await fetch(`${API}/api/deliveries/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveries }),
      });
    } catch (e) { console.error('Delivery log error:', e); }

    await updateCampaign(campaignId, {
      status: 'sent', sentAt: new Date().toISOString(),
      stats: { sent, delivered: sent, failed, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 },
    });
    localStorage.removeItem('nsp_campaign_draft');
    setSendResults({ sent, failed, total: okEmails.length, campaignId });
    setSending(false);
    setStep(8);
  };

  const isOptimalTime = () => {
    const d = new Date(); const day = d.getDay(); const h = d.getHours();
    return day >= 2 && day <= 4 && ((h >= 9 && h <= 11) || (h >= 13 && h <= 15));
  };

  const loadStylePreview = async (style) => {
    const sample = generatedEmails.find(e => e.status === 'ok');
    if (!sample) return;
    try {
      const res = await fetch(`${API}/api/email/prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyHtml: sample.bodyHTML || `<p>${sample.bodyText}</p>`,
          style, fromName, fromEmail, contactId: sample.contactId, campaignId: 'preview',
          trackingOverrides: { uniqueLinksEnabled: false, openPixelEnabled: false },
        }),
      });
      const data = await res.json();
      setPreviewHtml(data.html);
    } catch (e) { setPreviewHtml('<p>Preview unavailable</p>'); }
  };

  const steps = ['Audience', 'Brief', 'Preview', 'Generate', 'Audit', 'Samples', 'Send'];
  const ProgressBar = () => (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => {
        const num = i + 1;
        const done = step > num;
        const current = step === num;
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <button onClick={() => { if (num < step) setStep(num); }} disabled={num >= step}
              className={`text-xs font-medium px-2 py-1 rounded-lg transition ${done ? 'bg-green-100 text-green-700' : current ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
              {done ? '✓' : ''} {s}
            </button>
            {i < steps.length - 1 && <div className={`h-0.5 flex-1 ${done ? 'bg-green-300' : 'bg-gray-200'}`} />}
          </div>
        );
      })}
    </div>
  );

  // ═══════════════════════════════════
  // STEP 1 — AUDIENCE (4 methods + exclusions)
  // ═══════════════════════════════════
  if (step === 1) return (
    <div className="max-w-3xl mx-auto">
      <ProgressBar />
      <h2 className="text-xl font-bold text-gray-800 mb-4">Select Audience</h2>

      {/* Audience Method Tabs */}
      <div className="flex gap-2 mb-4">
        {[
          { id: 'list', icon: '📋', label: 'From a List' },
          { id: 'nearby', icon: '📍', label: 'Near Address' },
          { id: 'priority', icon: '🔥', label: 'High Priority' },
          { id: 'ai', icon: '💬', label: 'AI Suggest' },
        ].map(m => (
          <button key={m.id} onClick={() => { setAudienceMethod(m.id); if (m.id === 'priority') loadAllForPriority(); }}
            className={`flex-1 p-3 rounded-xl border text-center text-sm transition ${audienceMethod === m.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-200 hover:border-blue-300'}`}>
            <span className="text-lg block">{m.icon}</span>{m.label}
          </button>
        ))}
      </div>

      {/* Method: From a List */}
      {audienceMethod === 'list' && (
        <div className="space-y-3 mb-4">
          {lists.map(l => (
            <button key={l.id} onClick={() => selectList(l.id)}
              className={`w-full text-left p-4 rounded-xl border transition ${selectedListId === l.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
              <div className="flex items-center gap-2">
                <p className="font-medium text-gray-800">{l.name}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${l.tier === 'personal' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{l.tier}</span>
              </div>
              <p className="text-sm text-gray-500">{l.contactCount || 0} contacts</p>
            </button>
          ))}
        </div>
      )}

      {/* Method: Near Address */}
      {audienceMethod === 'nearby' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex gap-3 mb-3">
            <input type="text" value={nearbyAddress} onChange={e => setNearbyAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchNearby()}
              placeholder="e.g., 4600 S Four Mile Run Dr Arlington VA"
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <select value={nearbyRadius} onChange={e => setNearbyRadius(parseFloat(e.target.value))} className="w-28 border rounded-lg px-3 py-2 text-sm">
              <option value={0.1}>0.1 mi</option><option value={0.25}>0.25 mi</option><option value={0.5}>0.5 mi</option><option value={1}>1 mi</option><option value={2}>2 mi</option><option value={5}>5 mi</option>
            </select>
            <button onClick={searchNearby} disabled={nearbySearching} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
              {nearbySearching ? '...' : 'Search'}
            </button>
          </div>
          {nearbyResults && <p className="text-sm text-gray-600">{nearbyResults.nearby?.length || 0} contacts found within {nearbyRadius} mi</p>}
        </div>
      )}

      {/* Method: High Priority */}
      {audienceMethod === 'priority' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Storm Score</label>
          <select value={minStormScore} onChange={e => setMinStormScore(parseInt(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value={50}>50+ (moderate priority)</option><option value={60}>60+</option><option value={70}>70+ (high priority)</option><option value={80}>80+ (top priority)</option>
          </select>
          <p className="text-sm text-gray-600 mt-2">{audienceContacts.length} contacts scoring {minStormScore}+ across all lists</p>
        </div>
      )}

      {/* Method: AI Suggest */}
      {audienceMethod === 'ai' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="bg-gray-50 rounded-xl p-4 mb-3 max-h-64 overflow-y-auto space-y-2">
            {strategyMessages.length === 0 && <p className="text-sm text-gray-400">Describe what you want to do. AI will recommend a list and approach.</p>}
            {strategyMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                  <div className="whitespace-pre-wrap">{m.content.replace(/```json[\s\S]*?```/g, '').trim()}</div>
                </div>
              </div>
            ))}
            {strategyLoading && <div className="text-xs text-gray-400">Thinking...</div>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={strategyInput} onChange={e => setStrategyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendStrategyMessage()}
              placeholder="e.g., I want to email my CertaPro list, spring exterior angle..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button onClick={sendStrategyMessage} disabled={strategyLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Send</button>
          </div>
          {strategyBrief && (
            <button onClick={applyStrategyBrief} className="w-full mt-3 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">
              ✓ Use AI Recommendation → Fill Campaign Brief
            </button>
          )}
        </div>
      )}

      {/* Loading indicator for large lists */}
      {listLoading && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-center">
          <p className="text-sm text-blue-700">Loading contacts...</p>
        </div>
      )}

      {/* Sender + Filters (shown for list and priority methods) */}
      {(audienceMethod === 'list' && selectedListId && !listLoading || audienceMethod === 'priority' || (audienceMethod === 'nearby' && nearbyResults?.nearby?.length)) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Send From</label>
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

          {audienceMethod === 'list' && cities.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">All Cities</option>
                  {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Engagement</label>
                <select value={openerFilter} onChange={e => setOpenerFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="all">All</option><option value="openers">Opened previous</option><option value="non-openers">Didn't open</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exclusion Rules */}
      {audienceContacts.length > 0 && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-700">Exclude from this campaign</h3>
          </div>

          {exclusions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {exclusions.map((ex, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs px-2.5 py-1 rounded-full">
                  {ex.label}
                  <button onClick={() => removeExclusion(i)} className="text-red-400 hover:text-red-600 font-bold">x</button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {lists.filter(l => l.id !== selectedListId && !exclusions.some(e => e.type === 'list' && e.value === l.id))
              .filter((l, i, arr) => arr.findIndex(x => x.name === l.name) === i)
              .map(l => (
              <button key={l.id} onClick={() => addExclusion('list', l.id, `Not in: ${l.name}`)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600 transition">
                + Exclude {l.name}
              </button>
            ))}
            {cities.filter(c => c !== cityFilter).slice(0, 5).map(c => (
              <button key={c} onClick={() => addExclusion('city', c, `Not in: ${c}`)}
                className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600 transition">
                + Exclude {c}
              </button>
            ))}
            <button onClick={() => addExclusion('engagement', 'non-openers', 'Exclude non-openers')}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600 transition">
              + Exclude non-openers
            </button>
          </div>
        </div>
      )}

      {/* Audience Summary + Next */}
      {audienceContacts.length > 0 && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-semibold text-blue-800">Final Audience: {audienceContacts.length} contacts</p>
            {exclusions.length > 0 && <p className="text-xs text-blue-600">{exclusions.length} exclusion rule{exclusions.length > 1 ? 's' : ''} applied</p>}
            {fromName && <p className="text-xs text-blue-600">From: {fromName} &lt;{fromEmail}&gt;</p>}
          </div>
          <button onClick={() => setStep(2)} disabled={!audienceContacts.length || !fromName}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
            Next → Campaign Brief
          </button>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════
  // STEP 2 — CAMPAIGN BRIEF
  // ═══════════════════════════════════
  if (step === 2) return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar />
      <h2 className="text-xl font-bold text-gray-800 mb-1">Campaign Brief</h2>
      <p className="text-sm text-gray-500 mb-4">Tell the AI exactly what to write. Paste from Claude Project or fill in manually.</p>

      <div className="space-y-5">
        {/* Subject Line Strategy */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="block text-sm font-bold text-gray-800 mb-3">Subject Line Strategy</label>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { id: 'same-all', label: 'Same for everyone' },
              { id: 'personalize-name', label: 'Personalize by name' },
              { id: 'personalize-city', label: 'By name + city' },
              { id: 'fully-unique', label: 'Fully unique each' },
            ].map(s => (
              <button key={s.id} onClick={() => setBrief({ ...brief, subjectStrategy: s.id })}
                className={`p-2.5 rounded-lg border text-sm text-left ${brief.subjectStrategy === s.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-200'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <input type="text" value={brief.subjectTemplate} onChange={e => setBrief({ ...brief, subjectTemplate: e.target.value })}
            placeholder='e.g., "{FirstName}, your {City} home is due" or leave blank for AI to decide'
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        {/* Content Direction */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="block text-sm font-bold text-gray-800 mb-2">Content Direction</label>
          <p className="text-xs text-gray-400 mb-2">What should the email say? Paste instructions from Claude Project or describe it yourself.</p>
          <textarea value={brief.contentDirection} onChange={e => setBrief({ ...brief, contentDirection: e.target.value })} rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder='e.g., "Reference their specific property. Mention spring is the best time for exterior. Frame as a personal check-in, not a sales pitch. End with a soft question like &#39;been thinking about any updates?&#39;"' />
        </div>

        {/* Must Include / Must NOT */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="block text-sm font-bold text-gray-800 mb-3">Must Include</label>
            {[
              { key: 'address', label: 'Property address' },
              { key: 'yearsSince', label: 'Years since last job' },
              { key: 'paintColor', label: 'Paint color (if on file)' },
              { key: 'weather', label: 'Weather / conditions' },
              { key: 'seasonal', label: 'Seasonal urgency' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 mb-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={brief.mustInclude[item.key] || false}
                  onChange={e => setBrief({ ...brief, mustInclude: { ...brief.mustInclude, [item.key]: e.target.checked } })}
                  className="rounded" />
                {item.label}
              </label>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="block text-sm font-bold text-gray-800 mb-3">Must NOT Include</label>
            {[
              { key: 'discounts', label: 'Discounts or offers' },
              { key: 'dearValued', label: '"Dear valued customer"' },
              { key: 'hardCta', label: 'Hard CTA / pushy buttons' },
              { key: 'images', label: 'Images or graphics' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 mb-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={brief.mustNotInclude[item.key] || false}
                  onChange={e => setBrief({ ...brief, mustNotInclude: { ...brief.mustNotInclude, [item.key]: e.target.checked } })}
                  className="rounded" />
                {item.label}
              </label>
            ))}
          </div>
        </div>

        {/* Tone + Length */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="block text-sm font-bold text-gray-800 mb-2">Tone</label>
            <select value={brief.tone} onChange={e => setBrief({ ...brief, tone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="casual-personal">Casual & Personal</option>
              <option value="professional-warm">Professional & Warm</option>
              <option value="friendly-checkin">Friendly Check-in</option>
              <option value="urgent">Urgent (not pushy)</option>
            </select>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="block text-sm font-bold text-gray-800 mb-2">Length</label>
            <select value={brief.length} onChange={e => setBrief({ ...brief, length: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="short">Short (under 100 words)</option>
              <option value="medium">Medium (under 150 words)</option>
              <option value="standard">Standard (under 200 words)</option>
            </select>
          </div>
        </div>

        {/* Call to Action */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="block text-sm font-bold text-gray-800 mb-3">Call to Action</label>
          <div className="flex gap-2 mb-3">
            {[
              { id: 'none', label: 'No CTA' },
              { id: 'link', label: 'Text Link' },
              { id: 'button', label: 'Button' },
            ].map(c => (
              <button key={c.id} onClick={() => setBrief({ ...brief, ctaType: c.id })}
                className={`px-4 py-2 rounded-lg border text-sm ${brief.ctaType === c.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-200'}`}>
                {c.label}
              </button>
            ))}
          </div>
          {brief.ctaType !== 'none' && (
            <div className="space-y-2">
              {brief.ctaType === 'button' && (
                <input type="text" value={brief.ctaText} onChange={e => setBrief({ ...brief, ctaText: e.target.value })}
                  placeholder="Button text (e.g., 'Schedule Your Estimate')" className="w-full border rounded-lg px-3 py-2 text-sm" />
              )}
              <input type="url" value={brief.ctaUrl} onChange={e => setBrief({ ...brief, ctaUrl: e.target.value })}
                placeholder="https://northernstarpainters.com/contact" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={() => setStep(1)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Audience</button>
          <button onClick={() => { setStep(3); generate3Samples(); }}
            disabled={!brief.contentDirection.trim()}
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
            Preview 3 Samples →
          </button>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════
  // STEP 3 — 3-SAMPLE PREVIEW
  // ═══════════════════════════════════
  if (step === 3) return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar />
      <h2 className="text-xl font-bold text-gray-800 mb-1">Quick Preview</h2>
      <p className="text-sm text-gray-500 mb-4">3 real emails generated from your brief. Check the pattern before generating all {audienceContacts.length}.</p>

      {quickSampleLoading ? (
        <div className="text-center py-12">
          <div className="flex gap-1 justify-center mb-3">
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-sm text-gray-500">Generating 3 sample emails with real contact data...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {quickSamples.map((sample, i) => (
            <div key={i} className={`bg-white rounded-xl border ${sample.status === 'ok' ? 'border-gray-200' : 'border-red-200'} overflow-hidden`}>
              <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  To: {sample.contact?.firstName} {sample.contact?.lastName} — {sample.contact?.address?.city || 'N/A'} — {sample.contact?.email}
                </div>
                <span className="text-xs text-gray-400">Sample {i + 1}</span>
              </div>
              {sample.status === 'ok' ? (
                <div className="p-4">
                  <p className="text-sm font-semibold text-gray-800 mb-2">Subject: {sample.subject}</p>
                  <div className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: sample.bodyHTML || `<p>${sample.bodyText}</p>` }} />
                </div>
              ) : (
                <div className="p-4 text-sm text-red-600">Error generating: {sample.error}</div>
              )}
            </div>
          ))}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Edit Brief</button>
            <button onClick={generate3Samples} className="px-6 py-3 border border-blue-300 text-blue-700 rounded-lg text-sm font-medium">
              Regenerate 3 Samples
            </button>
            <button onClick={generateAll} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium">
              ✓ Looks Good → Generate All {audienceContacts.length}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════
  // STEP 4 — GENERATING ALL
  // ═══════════════════════════════════
  if (step === 4) return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar />
      <div className="text-center py-12">
        <p className="text-4xl mb-4">🤖</p>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Generating {audienceContacts.length} Emails...</h2>
        <p className="text-sm text-gray-500 mb-4">{genProgress.done} of {genProgress.total}</p>
        <div className="w-full bg-gray-200 rounded-full h-3 max-w-md mx-auto">
          <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${genProgress.total ? (genProgress.done / genProgress.total * 100) : 0}%` }} />
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════
  // STEP 5 — AUDIT RESULTS
  // ═══════════════════════════════════
  if (step === 5) return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar />
      <h2 className="text-xl font-bold text-gray-800 mb-4">Audit Results</h2>

      {auditResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 rounded-xl p-4 text-center"><p className="text-2xl font-bold text-green-700">{auditResult.passed || 0}</p><p className="text-xs text-green-600">Passed</p></div>
            <div className="bg-yellow-50 rounded-xl p-4 text-center"><p className="text-2xl font-bold text-yellow-700">{(auditResult.warnings || []).length}</p><p className="text-xs text-yellow-600">Warnings</p></div>
            <div className="bg-red-50 rounded-xl p-4 text-center"><p className="text-2xl font-bold text-red-700">{(auditResult.critical || []).length}</p><p className="text-xs text-red-600">Critical</p></div>
          </div>
          <p className="text-sm text-gray-600">{auditResult.summary}</p>

          {(auditResult.critical || []).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <h3 className="font-semibold text-red-800 text-sm mb-2">Critical Issues</h3>
              {auditResult.critical.map((c, i) => <p key={i} className="text-sm text-red-700 mb-1">• {c.email}: {c.issue}</p>)}
            </div>
          )}
          {(auditResult.warnings || []).length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <h3 className="font-semibold text-yellow-800 text-sm mb-2">Warnings</h3>
              {auditResult.warnings.slice(0, 5).map((w, i) => <p key={i} className="text-sm text-yellow-700 mb-1">• {w.email}: {w.issue}</p>)}
              {auditResult.warnings.length > 5 && <p className="text-xs text-yellow-600 mt-1">+{auditResult.warnings.length - 5} more</p>}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Edit Brief</button>
            <button onClick={() => {
              const ok = generatedEmails.filter(e => e.status === 'ok');
              const shuffled = [...ok].sort(() => Math.random() - 0.5);
              setSampleEmails(shuffled.slice(0, Math.min(10, shuffled.length)));
              setSampleIndex(0);
              setStep(6);
            }} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">
              Review 10 Samples →
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════
  // STEP 6 — SAMPLE REVIEW (10) + TEST EMAIL
  // ═══════════════════════════════════
  if (step === 6) return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar />
      <h2 className="text-lg font-bold text-gray-800 mb-4">Sample Review — {sampleIndex + 1} of {sampleEmails.length}</h2>

      {sampleEmails.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
          <div className="bg-gray-50 px-4 py-2 border-b text-xs text-gray-500">
            To: {sampleEmails[sampleIndex]?.email}
          </div>
          <div className="p-5">
            <p className="text-sm font-semibold text-gray-800 mb-3">Subject: {sampleEmails[sampleIndex]?.subject}</p>
            <div className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: sampleEmails[sampleIndex]?.bodyHTML || sampleEmails[sampleIndex]?.bodyText }} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setSampleIndex(Math.max(0, sampleIndex - 1))} disabled={sampleIndex === 0}
          className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30">← Prev</button>
        <span className="text-sm text-gray-500">{sampleIndex + 1} / {sampleEmails.length}</span>
        <button onClick={() => setSampleIndex(Math.min(sampleEmails.length - 1, sampleIndex + 1))} disabled={sampleIndex >= sampleEmails.length - 1}
          className="px-4 py-2 border rounded-lg text-sm disabled:opacity-30">Next →</button>
      </div>

      {/* Send Test Email */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
        <h3 className="text-sm font-bold text-amber-800 mb-2">Send Test Email</h3>
        <p className="text-xs text-amber-600 mb-2">
          {(!sampleEmails.length && !generatedEmails.some(e => e.status === 'ok'))
            ? 'Generate emails first (complete Step 4) before sending a test.'
            : 'Send this sample to yourself to check how it looks in Gmail. Uses the selected design style.'}
        </p>
        <div className="flex gap-2">
          <input type="text" value={testEmails} onChange={e => setTestEmails(e.target.value)}
            placeholder="your@email.com (up to 3, comma-separated)"
            className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white"
            disabled={!sampleEmails.length && !generatedEmails.some(e => e.status === 'ok')} />
          <button onClick={sendTestEmail} disabled={testSending || !testEmails.trim() || (!sampleEmails.length && !generatedEmails.some(e => e.status === 'ok'))}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            title={(!sampleEmails.length && !generatedEmails.some(e => e.status === 'ok')) ? 'Generate emails first (complete Step 4)' : ''}>
            {testSending ? 'Sending...' : 'Send Test'}
          </button>
        </div>
        {testResult && (
          <div className="mt-2 text-xs">
            {testResult.error ? (
              <p className="text-red-600">Error: {testResult.error}</p>
            ) : (
              testResult.results?.map((r, i) => (
                <p key={i} className={r.ok ? 'text-green-600' : 'text-red-600'}>
                  {r.email}: {r.ok ? '✅ Sent' : `Failed — ${r.error}`}
                </p>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button onClick={() => setStep(5)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Audit</button>
        <button onClick={() => setStep(7)} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium">
          Approve → Design & Send
        </button>
      </div>
    </div>
  );

  // ═══════════════════════════════════
  // STEP 7 — DESIGN + CONFIRM & SEND
  // ═══════════════════════════════════
  if (step === 7) return (
    <div className="max-w-4xl mx-auto">
      <ProgressBar />
      <h2 className="text-xl font-bold text-gray-800 mb-4">Design & Send</h2>

      <div className="flex gap-6">
        {/* Left: Controls */}
        <div className="flex-1 space-y-4">
          {/* Design Style */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="block text-sm font-bold text-gray-800 mb-3">Email Style</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'personal', label: 'Pure Personal', desc: 'Plain text, no branding' },
                { id: 'soft-branded', label: 'Soft Branded', desc: 'Logo + clean text' },
                { id: 'campaign', label: 'Campaign', desc: 'Full branding + CTA' },
              ].map(s => (
                <button key={s.id} onClick={() => { setDesignStyle(s.id); loadStylePreview(s.id); }}
                  className={`p-3 rounded-lg border text-left text-sm ${designStyle === s.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="font-medium">{s.label}</p>
                  <p className="text-xs text-gray-500">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Tracking */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-sm font-bold text-gray-800 mb-2">Tracking</label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={trackingConfig.uniqueLinksEnabled} onChange={e => setTrackingConfig({ ...trackingConfig, uniqueLinksEnabled: e.target.checked })} />
                Unique links
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={trackingConfig.openPixelEnabled} onChange={e => setTrackingConfig({ ...trackingConfig, openPixelEnabled: e.target.checked })} />
                Open pixel
              </label>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">To:</span> <span className="font-medium">{audienceContacts.length} contacts</span></div>
              <div><span className="text-gray-500">From:</span> <span className="font-medium">{fromName}</span></div>
              <div><span className="text-gray-500">Style:</span> <span className="font-medium">{designStyle === 'personal' ? 'Pure Personal' : designStyle === 'soft-branded' ? 'Soft Branded' : 'Campaign'}</span></div>
              <div><span className="text-gray-500">Audit:</span> <span className="font-medium text-green-600">{auditResult?.passed || 0} passed</span></div>
            </div>

            {!isOptimalTime() && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-800">Outside optimal send window (Tue-Thu, 9-11am or 1-3pm)</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(6)} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">← Samples</button>
            <button onClick={sendCampaign} disabled={sending}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
              {sending ? 'Sending...' : `✓ Send ${audienceContacts.length} Emails`}
            </button>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="w-96 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-800">Live Preview</h3>
            <div className="flex gap-1">
              <button onClick={() => setPreviewMode('desktop')} className={`px-2 py-1 rounded text-xs ${previewMode === 'desktop' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Desktop</button>
              <button onClick={() => setPreviewMode('mobile')} className={`px-2 py-1 rounded text-xs ${previewMode === 'mobile' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>Mobile</button>
            </div>
          </div>
          <div className={`bg-white border border-gray-300 rounded-lg overflow-hidden ${previewMode === 'mobile' ? 'max-w-[375px] mx-auto' : ''}`}>
            <div className="bg-gray-100 px-3 py-2 border-b flex items-center gap-2">
              <div className="flex gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400" /><span className="w-2.5 h-2.5 rounded-full bg-green-400" /></div>
              <span className="text-xs text-gray-500">mail.google.com</span>
            </div>
            <div className="p-3">
              <p className="text-xs text-gray-500">From: {fromName} &lt;{fromEmail}&gt;</p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{generatedEmails.find(e => e.status === 'ok')?.subject || 'Subject'}</p>
              <div className="mt-3 border-t pt-3">
                {previewHtml ? (
                  <iframe srcDoc={previewHtml} className="w-full border-0" style={{ minHeight: '400px' }} title="Email preview" />
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-400">Click a style to see preview</p>
                    <button onClick={() => loadStylePreview(designStyle)} className="mt-2 text-xs text-blue-600 hover:underline">Load Preview</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════
  // STEP 8 — DONE
  // ═══════════════════════════════════
  if (step === 8) return (
    <div className="max-w-2xl mx-auto text-center py-12">
      <p className="text-5xl mb-4">✅</p>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Campaign Sent!</h2>
      {sendResults && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4 inline-block">
          <div className="grid grid-cols-3 gap-8">
            <div className="text-center"><p className="text-3xl font-bold text-green-600">{sendResults.sent}</p><p className="text-sm text-gray-500">Sent</p></div>
            <div className="text-center"><p className="text-3xl font-bold text-red-600">{sendResults.failed}</p><p className="text-sm text-gray-500">Failed</p></div>
            <div className="text-center"><p className="text-3xl font-bold text-gray-800">{sendResults.total}</p><p className="text-sm text-gray-500">Total</p></div>
          </div>
        </div>
      )}
      <div className="flex gap-3 justify-center mt-6">
        <button onClick={() => navigate('/')} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium text-sm">Back to Home</button>
        <button onClick={() => navigate('/reports')} className="px-6 py-3 border border-gray-300 rounded-lg text-sm">View Reports</button>
      </div>
    </div>
  );

  return null;
}
