import { useState, useEffect, useMemo } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

export default function LeadFinder() {
  const [tab, setTab] = useState('today');
  const [leads, setLeads] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [scraperStatus, setScraperStatus] = useState({});
  const [expandedLead, setExpandedLead] = useState(null);

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      const [leadsSnap, allContacts] = await Promise.all([
        getDocs(query(collection(db, 'leads'), where('userId', '==', uid))),
        getAllContacts(uid),
      ]);
      setLeads(leadsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.stormScore || 0) - (a.stormScore || 0)));
      setContacts(allContacts);
      // Get scraper status
      try { const r = await fetch(`${API}/api/scraper/status`); setScraperStatus(await r.json()); } catch(e) {}
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let result = leads;
    if (tab === 'today') {
      const today = new Date().toISOString().split('T')[0];
      result = result.filter(l => l.detectedDate?.startsWith(today) || !l.detectedDate);
    }
    if (sourceFilter !== 'all') result = result.filter(l => l.source === sourceFilter);
    if (cityFilter) result = result.filter(l => l.address?.city === cityFilter);
    if (scoreFilter === 'hot') result = result.filter(l => (l.stormScore || 0) >= 80);
    else if (scoreFilter === 'warm') result = result.filter(l => (l.stormScore || 0) >= 60);
    else if (scoreFilter === 'active') result = result.filter(l => (l.stormScore || 0) >= 40);
    if (channelFilter === 'email') result = result.filter(l => l.email);
    else if (channelFilter === 'phone') result = result.filter(l => l.phone?.length > 0);
    else if (channelFilter === 'address') result = result.filter(l => !l.email && !l.phone?.length);
    return result;
  }, [leads, tab, sourceFilter, cityFilter, scoreFilter, channelFilter]);

  const cities = [...new Set(leads.map(l => l.address?.city).filter(Boolean))].sort();
  const stats = {
    total: leads.length,
    today: leads.filter(l => l.detectedDate?.startsWith(new Date().toISOString().split('T')[0])).length,
    withEmail: leads.filter(l => l.email).length,
    hot: leads.filter(l => (l.stormScore || 0) >= 80).length,
  };

  const sendOutreach = async (lead, channel) => {
    if (!lead.generatedOutreach) { alert('No outreach generated yet'); return; }
    try {
      if (channel === 'email' && lead.email) {
        const outreach = lead.generatedOutreach.email;
        await fetch(`${API}/api/send/brevo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromEmail: 'amirz@northernstarpainters.com', fromName: 'Amir Zreik',
            toEmail: lead.email, toName: lead.ownerName?.split(',')[0] || '',
            subject: outreach.subject, htmlContent: `<p>${outreach.body}</p>`,
            textContent: outreach.body
          }),
        });
        await updateDoc(doc(db, 'leads', lead.id), { outreachSent: new Date().toISOString(), outreachChannel: 'email', status: 'contacted' });
        alert('Email sent!');
      } else if (channel === 'text' && lead.phone?.length) {
        await fetch(`${API}/api/send/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: lead.phone[0], text: lead.generatedOutreach.text, sender: 'NSPainters' }),
        });
        await updateDoc(doc(db, 'leads', lead.id), { outreachSent: new Date().toISOString(), outreachChannel: 'text', status: 'contacted' });
        alert('Text sent!');
      }
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'contacted', outreachSent: new Date().toISOString() } : l));
    } catch(e) { alert('Send failed: ' + e.message); }
  };

  const dismissLead = async (leadId) => {
    await updateDoc(doc(db, 'leads', leadId), { status: 'dismissed', dismissedDate: new Date().toISOString() });
    setLeads(prev => prev.filter(l => l.id !== leadId));
  };

  const generateOutreach = async (lead) => {
    try {
      const res = await fetch(`${API}/api/leads/generate-outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead, nearbyJobs: [] }),
      });
      const outreach = await res.json();
      await updateDoc(doc(db, 'leads', lead.id), { generatedOutreach: outreach });
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, generatedOutreach: outreach } : l));
    } catch(e) { alert('Generation failed: ' + e.message); }
  };

  const getScoreColor = (score) => {
    if (score >= 80) return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: '🔴' };
    if (score >= 60) return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500', label: '🟠' };
    if (score >= 40) return { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500', label: '🟡' };
    if (score >= 20) return { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400', label: '⚪' };
    return { bg: 'bg-blue-50', text: 'text-blue-600', dot: 'bg-blue-300', label: '❄️' };
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading leads...</p>;

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🔍 Lead Finder</h1>
          <p className="text-sm text-gray-500">{stats.total} total leads · {stats.today} today · {stats.hot} hot · {stats.withEmail} contactable</p>
        </div>
        <div className="flex gap-2">
          {['today', 'pipeline', 'sources'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {t === 'today' ? "Today's Leads" : t === 'pipeline' ? 'Pipeline' : 'Sources'}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: Today's Leads */}
      {tab === 'today' && (
        <div>
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Sources</option>
              <option value="deed_record">New Sales</option>
              <option value="permit">Permits</option>
            </select>
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="">All Cities</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={scoreFilter} onChange={e => setScoreFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Scores</option>
              <option value="hot">🔴 Hot 80+</option>
              <option value="warm">🟠 Warm 60+</option>
              <option value="active">🟡 Active 40+</option>
            </select>
            <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Channels</option>
              <option value="email">Has Email</option>
              <option value="phone">Has Phone</option>
              <option value="address">Address Only</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-gray-500">No leads match your filters.</p>
              <p className="text-gray-400 text-sm mt-1">{leads.length === 0 ? 'County scrapers will populate leads automatically. Check Sources tab.' : 'Try adjusting your filters.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(lead => {
                const sc = getScoreColor(lead.stormScore || 0);
                const isExpanded = expandedLead === lead.id;
                return (
                  <div key={lead.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    {/* Score + Name */}
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-lg font-bold ${sc.text}`}>{sc.label} {lead.stormScore || 0}</span>
                        <div>
                          <h3 className="font-semibold text-gray-800">{lead.ownerName || 'Unknown'}</h3>
                          <p className="text-sm text-gray-500">{lead.address?.street}, {lead.address?.city} {lead.address?.state} {lead.address?.zip}</p>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">{lead.detectedDate ? new Date(lead.detectedDate).toLocaleDateString() : ''}</span>
                    </div>

                    {/* Contact info */}
                    <div className="flex gap-3 text-sm mb-2">
                      {lead.email ? <span className="text-green-600">📧 {lead.email}</span> : <span className="text-gray-400">📧 Not found</span>}
                      {lead.phone?.length ? <span className="text-green-600">📱 {lead.phone[0]}</span> : <span className="text-gray-400">📱 Not found</span>}
                    </div>

                    {/* Source + sale info */}
                    <p className="text-xs text-gray-500 mb-2">
                      Source: {lead.source === 'deed_record' ? '🏠 New home sale' : lead.source === 'permit' ? '📋 Permit filed' : lead.source || 'Unknown'}
                      {lead.salePrice ? ` · $${Number(lead.salePrice).toLocaleString()}` : ''}
                      {lead.saleDate ? ` · ${new Date(lead.saleDate).toLocaleDateString()}` : ''}
                    </p>

                    {/* Signal chips */}
                    {lead.stormScoreBreakdown && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {Object.entries(lead.stormScoreBreakdown).map(([signal, points]) => (
                          <span key={signal} className={`text-xs px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                            {signal} +{points}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI Assessment */}
                    {lead.propertyAnalysis?.aiAssessmentSummary && (
                      <div className="bg-blue-50 rounded-lg p-2 mb-2">
                        <p className="text-xs text-blue-600 font-medium">🤖 AI Assessment</p>
                        <p className="text-sm text-gray-700">{lead.propertyAnalysis.aiAssessmentSummary}</p>
                      </div>
                    )}

                    {/* AI Outreach */}
                    {lead.generatedOutreach ? (
                      <div className="bg-green-50 rounded-lg p-2 mb-2">
                        <p className="text-xs text-green-600 font-medium">✉️ AI Outreach Ready</p>
                        <p className="text-sm text-gray-700 line-clamp-2">{lead.generatedOutreach.email?.body || lead.generatedOutreach.text || ''}</p>
                      </div>
                    ) : (
                      <button onClick={() => generateOutreach(lead)} className="text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded mb-2">🤖 Generate Outreach</button>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 flex-wrap">
                      {lead.email && <button onClick={() => sendOutreach(lead, 'email')} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">📧 Send Email</button>}
                      {lead.phone?.length > 0 && <button onClick={() => sendOutreach(lead, 'text')} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg">💬 Send Text</button>}
                      {!lead.email && !lead.phone?.length && (
                        <>
                          <button className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded-lg">📮 Postcard PDF</button>
                          <button className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg">📢 Add to Ads</button>
                        </>
                      )}
                      <button onClick={() => setExpandedLead(isExpanded ? null : lead.id)} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg">
                        {isExpanded ? '▲ Less' : '▼ More'}
                      </button>
                      <button onClick={() => dismissLead(lead.id)} className="text-xs text-gray-400 px-2 py-1.5">🗑️</button>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                        {lead.propertyAnalysis && (
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-gray-500">Condition:</span> {lead.propertyAnalysis.paintCondition}</div>
                            <div><span className="text-gray-500">Last painted:</span> {lead.propertyAnalysis.estimatedLastPainted}</div>
                            <div><span className="text-gray-500">Surface:</span> {lead.propertyAnalysis.primarySurface}</div>
                            <div><span className="text-gray-500">Scope:</span> {lead.propertyAnalysis.estimatedJobScope}</div>
                            <div><span className="text-gray-500">Price range:</span> ${lead.propertyAnalysis.estimatedPriceRange?.low}-${lead.propertyAnalysis.estimatedPriceRange?.high}</div>
                            <div><span className="text-gray-500">Urgency:</span> {lead.propertyAnalysis.urgencyScore}/10</div>
                          </div>
                        )}
                        {lead.propertyAnalysis?.talkingPoints?.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 font-medium">Talking Points:</p>
                            <ul className="text-xs text-gray-700 list-disc ml-4">
                              {lead.propertyAnalysis.talkingPoints.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">📋 Shadow Estimate</button>
                          <button className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">➕ Add to Contacts</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Pipeline */}
      {tab === 'pipeline' && (
        <div>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {['new', 'contacted', 'replied', 'estimate_booked', 'won', 'dismissed'].map(stage => {
              const inStage = leads.filter(l => (l.status || 'new') === stage);
              return (
                <div key={stage} className="min-w-44 flex-shrink-0">
                  <div className={`rounded-lg p-2 mb-2 text-center text-sm font-medium ${stage === 'won' ? 'bg-green-100 text-green-700' : stage === 'dismissed' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'}`}>
                    {stage.replace('_', ' ').toUpperCase()} ({inStage.length})
                  </div>
                  <div className="space-y-1.5 max-h-80 overflow-y-auto">
                    {inStage.slice(0, 10).map(l => (
                      <div key={l.id} className="bg-white rounded-lg border border-gray-200 p-2 text-xs">
                        <p className="font-medium truncate">{l.ownerName}</p>
                        <p className="text-gray-400 truncate">{l.address?.city} · Score: {l.stormScore || 0}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
            <h3 className="font-semibold text-gray-700 mb-2">Pipeline Analytics</h3>
            <div className="grid grid-cols-4 gap-3 text-center text-sm">
              <div><p className="text-xl font-bold text-gray-800">{leads.filter(l => !l.status || l.status === 'new').length}</p><p className="text-xs text-gray-500">New</p></div>
              <div><p className="text-xl font-bold text-blue-600">{leads.filter(l => l.status === 'contacted').length}</p><p className="text-xs text-gray-500">Contacted</p></div>
              <div><p className="text-xl font-bold text-purple-600">{leads.filter(l => l.status === 'replied').length}</p><p className="text-xs text-gray-500">Replied</p></div>
              <div><p className="text-xl font-bold text-green-600">{leads.filter(l => l.status === 'won').length}</p><p className="text-xs text-gray-500">Won</p></div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Sources & Settings */}
      {tab === 'sources' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-700">Active Lead Sources</h3>
          {[
            { key: 'fairfax', name: '🏠 Fairfax County Deeds', type: 'New Home Sales' },
            { key: 'arlington', name: '🏠 Arlington County Deeds', type: 'New Home Sales' },
            { key: 'loudoun', name: '🏠 Loudoun County Deeds', type: 'New Home Sales' },
            { key: 'permits', name: '📋 Fairfax Permits', type: 'Renovation Permits' },
          ].map(source => {
            const status = scraperStatus[source.key] || {};
            return (
              <div key={source.key} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-800">{source.name}</h4>
                    <p className="text-xs text-gray-500">{source.type}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${status.status === 'running' ? 'bg-yellow-100 text-yellow-700' : status.lastRun ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {status.status || 'idle'}
                  </span>
                </div>
                {status.lastRun && <p className="text-xs text-gray-400 mt-1">Last run: {new Date(status.lastRun).toLocaleString()} · {status.leadsFound || 0} leads</p>}
              </div>
            );
          })}

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="font-medium text-gray-800 mb-2">Monthly Cost Breakdown</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">BeenVerified (skip trace)</span><span>$27.00</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Google APIs (Street View + Geocoding)</span><span>~$24.00</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Claude Vision (property analysis)</span><span>~$10.00</span></div>
              <hr className="my-1" />
              <div className="flex justify-between font-medium"><span>Total</span><span>~$61.00/mo</span></div>
              <div className="flex justify-between text-xs text-gray-400"><span>Cost per lead</span><span>~$0.04</span></div>
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <h4 className="font-medium text-yellow-800">Configuration Needed</h4>
            <ul className="text-sm text-yellow-700 mt-2 space-y-1">
              <li>{getKey('BEEN_VERIFIED_API_KEY') ? '✅' : '❌'} BeenVerified API Key</li>
              <li>{getKey('GOOGLE_STREET_VIEW_API_KEY') ? '✅' : '❌'} Google Street View API Key</li>
              <li>{getKey('GOOGLE_GEOCODING_API_KEY') ? '✅' : '❌'} Google Geocoding API Key</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function getKey(name) { return ''; /* Checked server-side */ }
