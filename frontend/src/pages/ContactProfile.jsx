import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const API = import.meta.env.VITE_API_URL || '';

export default function ContactProfile() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deliveries, setDeliveries] = useState([]);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [aiRewriting, setAiRewriting] = useState(false);
  const [aiRewriteResult, setAiRewriteResult] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonForm, setWonForm] = useState({ jobValue: '', jobType: 'Exterior', source: '', notes: '' });

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'emailContacts', contactId));
        if (snap.exists()) {
          const c = { id: snap.id, ...snap.data() };
          setContact(c);
          setNotes(c.intelligenceProfile?.personalNotes || '');
          setEditForm({
            firstName: c.firstName || '', lastName: c.lastName || '',
            email: c.email || '', phone: c.phone || '',
            street: c.address?.street || '', city: c.address?.city || '',
            state: c.address?.state || '', zip: c.address?.zip || '',
          });
        }
      } catch (e) { console.error('Error loading contact:', e); }

      // Load campaign delivery history
      try {
        const res = await fetch(`${API}/api/deliveries/contact/${contactId}`);
        const data = await res.json();
        setDeliveries(data);
      } catch (e) {}

      setLoading(false);
    })();
  }, [contactId]);

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      await updateDoc(doc(db, 'emailContacts', contactId), {
        'intelligenceProfile.personalNotes': notes,
        'intelligenceProfile.notesUpdatedAt': new Date().toISOString(),
      });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (e) { alert('Error saving: ' + e.message); }
    setNotesSaving(false);
  };

  const aiRewriteNotes = async () => {
    if (!notes.trim()) return;
    setAiRewriting(true);
    try {
      const res = await fetch(`${API}/api/ai/rewrite-notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, contactName: `${contact.firstName} ${contact.lastName}` }),
      });
      const data = await res.json();
      setAiRewriteResult({ original: notes, improved: data.rewritten });
    } catch (e) { alert('AI rewrite failed: ' + e.message); }
    setAiRewriting(false);
  };

  const acceptRewrite = () => {
    setNotes(aiRewriteResult.improved);
    setAiRewriteResult(null);
  };

  const saveEdit = async () => {
    try {
      await updateDoc(doc(db, 'emailContacts', contactId), {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        email: editForm.email.toLowerCase().trim(),
        phone: editForm.phone,
        address: { street: editForm.street, city: editForm.city, state: editForm.state, zip: editForm.zip },
        updatedAt: new Date().toISOString(),
      });
      setContact(prev => ({
        ...prev,
        firstName: editForm.firstName, lastName: editForm.lastName,
        email: editForm.email, phone: editForm.phone,
        address: { street: editForm.street, city: editForm.city, state: editForm.state, zip: editForm.zip },
      }));
      setEditing(false);
    } catch (e) { alert('Error saving: ' + e.message); }
  };

  const markAsWon = async () => {
    try {
      await fetch(`${API}/api/contacts/${contactId}/mark-won`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wonForm),
      });
      setContact(prev => ({ ...prev, converted: { isCustomer: true, ...wonForm, convertedAt: new Date().toISOString() } }));
      setShowWonModal(false);
    } catch (e) { alert('Error: ' + e.message); }
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading contact...</p>;
  if (!contact) return <p className="text-red-500 text-center py-10">Contact not found.</p>;

  const c = contact;
  const jobs = (c.jobHistory || []).sort((a, b) => new Date(b.jobDate || 0) - new Date(a.jobDate || 0));
  const stormScore = c.stormScore?.score || 0;
  const scoreColor = stormScore >= 80 ? 'text-red-600 bg-red-50 border-red-200' :
    stormScore >= 60 ? 'text-orange-600 bg-orange-50 border-orange-200' :
    stormScore >= 40 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' :
    'text-gray-600 bg-gray-50 border-gray-200';
  const scoreLabel = stormScore >= 80 ? 'Hot' : stormScore >= 60 ? 'Warm' : stormScore >= 40 ? 'Active' : 'Cold';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
        <div className="flex gap-2">
          {!c.converted?.isCustomer && (
            <button onClick={() => setShowWonModal(true)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">Mark as Won</button>
          )}
          <button onClick={() => setEditing(!editing)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">{editing ? 'Cancel' : 'Edit Contact'}</button>
        </div>
      </div>

      {/* Won badge */}
      {c.converted?.isCustomer && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-2">
          <span className="text-green-600 font-bold text-sm">CUSTOMER</span>
          <span className="text-xs text-green-600">Converted {c.converted.convertedAt ? new Date(c.converted.convertedAt).toLocaleDateString() : ''}</span>
          {c.converted.jobValue && <span className="text-xs text-green-600">· ${Number(c.converted.jobValue).toLocaleString()}</span>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Contact Info */}
        <div className="col-span-2 space-y-4">
          {/* Basic info / Edit form */}
          {editing ? (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                  <input type="text" value={editForm.firstName} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input type="text" value={editForm.lastName} onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input type="text" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Street</label>
                  <input type="text" value={editForm.street} onChange={e => setEditForm({ ...editForm, street: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                  <input type="text" value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">State/Zip</label>
                  <div className="flex gap-1">
                    <input type="text" value={editForm.state} onChange={e => setEditForm({ ...editForm, state: e.target.value })} className="w-12 border rounded-lg px-2 py-2 text-sm" />
                    <input type="text" value={editForm.zip} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} className="flex-1 border rounded-lg px-2 py-2 text-sm" />
                  </div>
                </div>
              </div>
              <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save Changes</button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h1 className="text-2xl font-bold text-gray-800">{c.firstName} {c.lastName}</h1>
              {c.address?.street && <p className="text-gray-500 text-sm mt-1">{c.address.street}, {c.address.city} {c.address.state} {c.address.zip}</p>}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm text-gray-500">{c.email}</span>
                {c.phone && <span className="text-sm text-gray-500">· {c.phone}</span>}
              </div>
            </div>
          )}

          {/* List Memberships */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">List Memberships</h3>
            <div className="flex flex-wrap gap-2">
              {(c.lists || []).map((l, i) => (
                <span key={i} className={`text-xs px-2.5 py-1 rounded-full ${l.tier === 'personal' ? 'bg-purple-100 text-purple-700' : l.tier === 'realtime' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {l.listName} ({l.tier})
                </span>
              ))}
              {(c.lists || []).length === 0 && <span className="text-xs text-gray-400">No list memberships</span>}
            </div>
            {c.sources?.length > 0 && (
              <div className="mt-3 text-xs text-gray-400">
                <p className="font-medium text-gray-500 mb-1">Sources:</p>
                {c.sources.map((s, i) => <p key={i}>{s.name} — {s.type} ({s.addedAt ? new Date(s.addedAt).toLocaleDateString() : ''})</p>)}
              </div>
            )}
          </div>

          {/* Job History */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Job History</h3>
            {jobs.length === 0 ? (
              <p className="text-sm text-gray-400">No job history on record</p>
            ) : (
              <div className="space-y-2">
                {(showAllJobs ? jobs : jobs.slice(0, 3)).map((j, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{j.company || 'Unknown'} · {j.jobType || 'Unknown type'}</p>
                      <p className="text-xs text-gray-500">{j.jobDate || 'Unknown date'} {j.salesRep ? `· Rep: ${j.salesRep}` : ''}</p>
                    </div>
                    {j.jobValue ? <span className="text-sm font-medium text-green-700">${Number(j.jobValue).toLocaleString()}</span> : null}
                  </div>
                ))}
                {jobs.length > 3 && !showAllJobs && (
                  <button onClick={() => setShowAllJobs(true)} className="text-xs text-blue-600 hover:underline">Show all {jobs.length} jobs</button>
                )}
              </div>
            )}
          </div>

          {/* Campaign History */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Campaign History</h3>
            {deliveries.length === 0 ? (
              <p className="text-sm text-gray-400">No campaigns sent to this contact yet</p>
            ) : (
              <div className="space-y-2">
                {(showAllCampaigns ? deliveries : deliveries.slice(0, 5)).map((d, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{d.campaignName || 'Campaign'}</p>
                      <p className="text-xs text-gray-500">Sent {d.sentAt ? new Date(d.sentAt).toLocaleDateString() : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={d.opened ? 'text-green-600' : 'text-gray-400'}>{d.opened ? 'Opened' : 'Not opened'}</span>
                      <span className={d.clicked ? 'text-green-600' : 'text-gray-400'}>{d.clicked ? 'Clicked' : ''}</span>
                      {d.status === 'failed' && <span className="text-red-500">Failed</span>}
                    </div>
                  </div>
                ))}
                {deliveries.length > 5 && !showAllCampaigns && (
                  <button onClick={() => setShowAllCampaigns(true)} className="text-xs text-blue-600 hover:underline">Show all {deliveries.length} campaigns</button>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Notes</h3>
            <textarea value={notes} onChange={e => { setNotes(e.target.value); setNotesSaved(false); }}
              rows={4} placeholder="Type what you remember about this customer..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={aiRewriteNotes} disabled={aiRewriting || !notes.trim()}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                {aiRewriting ? 'Rewriting...' : 'AI Rewrite'}
              </button>
              <button onClick={saveNotes} disabled={notesSaving}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                {notesSaving ? 'Saving...' : 'Save Notes'}
              </button>
              {notesSaved && <span className="text-xs text-green-600">Saved</span>}
              {c.intelligenceProfile?.notesUpdatedAt && (
                <span className="text-xs text-gray-400 ml-auto">Last saved: {new Date(c.intelligenceProfile.notesUpdatedAt).toLocaleString()}</span>
              )}
            </div>

            {/* AI Rewrite modal */}
            {aiRewriteResult && (
              <div className="mt-4 border border-purple-200 rounded-xl p-4 bg-purple-50">
                <h4 className="text-sm font-bold text-purple-800 mb-3">AI Improved Your Notes</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Before:</p>
                    <p className="text-sm text-gray-700 bg-white rounded-lg p-3">{aiRewriteResult.original}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-purple-600 mb-1">After:</p>
                    <p className="text-sm text-gray-700 bg-white rounded-lg p-3">{aiRewriteResult.improved}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={acceptRewrite} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium">Save Improved Version</button>
                  <button onClick={() => setAiRewriteResult(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-xs">Keep Original</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Storm Score */}
          <div className={`rounded-xl border p-5 text-center ${scoreColor}`}>
            <p className="text-4xl font-bold">{stormScore}</p>
            <p className="text-sm font-medium mt-1">{scoreLabel}</p>
            <button onClick={() => setShowBreakdown(!showBreakdown)} className="text-xs mt-2 opacity-70 hover:opacity-100">
              {showBreakdown ? 'Hide' : 'Show'} Breakdown
            </button>
            {showBreakdown && c.stormScore?.breakdown && (
              <div className="mt-3 text-left text-xs space-y-1 border-t pt-3">
                {Object.entries(c.stormScore.breakdown).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="font-bold">{v}</span>
                  </div>
                ))}
                {c.stormScore?.calculatedAt && (
                  <p className="text-xs opacity-50 mt-2">Last calculated: {new Date(c.stormScore.calculatedAt).toLocaleDateString()}</p>
                )}
              </div>
            )}
          </div>

          {/* Engagement Dashboard */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Engagement</h3>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-blue-50 rounded-lg p-2"><p className="text-lg font-bold text-blue-700">{c.engagement?.campaignsReceived || 0}</p><p className="text-xs text-blue-500">Received</p></div>
              <div className="bg-green-50 rounded-lg p-2"><p className="text-lg font-bold text-green-700">{c.engagement?.totalOpens || 0}</p><p className="text-xs text-green-500">Opens</p></div>
              <div className="bg-purple-50 rounded-lg p-2"><p className="text-lg font-bold text-purple-700">{c.engagement?.totalClicks || 0}</p><p className="text-xs text-purple-500">Clicks</p></div>
              <div className="bg-orange-50 rounded-lg p-2"><p className="text-lg font-bold text-orange-700">{c.engagement?.engagementScore || 0}</p><p className="text-xs text-orange-500">Score</p></div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-gray-500">Trend:</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                c.engagement?.engagementTrend === 'rising' ? 'bg-green-100 text-green-700' :
                c.engagement?.engagementTrend === 'stable' ? 'bg-blue-100 text-blue-700' :
                c.engagement?.engagementTrend === 'cooling' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-500'
              }`}>{c.engagement?.engagementTrend || 'new'}</span>
            </div>
            {c.engagement?.lastOpenDate && <p className="text-xs text-gray-400 mt-2">Last: {new Date(c.engagement.lastOpenDate).toLocaleDateString()}</p>}
          </div>

          {/* Tier & Sender */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Relationship</h3>
            <p className="text-sm"><span className={`font-medium px-2 py-0.5 rounded-full text-xs ${c.currentTier === 'personal' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{c.currentTier || 'general'}</span></p>
            {c.engagement?.recommendedSenderName && (
              <p className="text-xs text-gray-500 mt-2">Sender: {c.engagement.recommendedSenderName}</p>
            )}
          </div>

          {/* Tags */}
          {(c.tags || []).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((t, i) => <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mark as Won Modal */}
      {showWonModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowWonModal(false)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Mark as Won</h3>
            <div className="space-y-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Job Value ($)</label>
                <input type="number" value={wonForm.jobValue} onChange={e => setWonForm({ ...wonForm, jobValue: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="4200" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Job Type</label>
                <select value={wonForm.jobType} onChange={e => setWonForm({ ...wonForm, jobType: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option>Exterior</option><option>Interior</option><option>Interior + Exterior</option><option>Cabinet</option><option>Deck/Fence</option><option>Other</option>
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
                <select value={wonForm.source} onChange={e => setWonForm({ ...wonForm, source: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select source...</option>
                  {(c.lists || []).map((l, i) => <option key={i} value={l.listName}>{l.listName}</option>)}
                  <option value="referral">Referral</option><option value="website">Website</option><option value="other">Other</option>
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                <input type="text" value={wonForm.notes} onChange={e => setWonForm({ ...wonForm, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={markAsWon} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">Save</button>
              <button onClick={() => setShowWonModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
