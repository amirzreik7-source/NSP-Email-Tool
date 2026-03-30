import { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, orderBy, updateDoc, doc } from 'firebase/firestore';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';
const CONVERSATIONS_COL = 'textConversations';

export default function Conversations() {
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeConvo, setActiveConvo] = useState(null);
  const [showNewMessage, setShowNewMessage] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const uid = auth.currentUser.uid;
    const [convos, allContacts] = await Promise.all([
      getDocs(query(collection(db, CONVERSATIONS_COL), where('userId', '==', uid))),
      getAllContacts(uid),
    ]);
    setConversations(convos.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
    setContacts(allContacts);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (activeConvo) return <ConvoThread convo={activeConvo} onBack={() => { setActiveConvo(null); loadAll(); }} />;
  if (showNewMessage) return <NewTextMessage contacts={contacts} onDone={() => { setShowNewMessage(false); loadAll(); }} />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">💬 Conversations</h1>
          <p className="text-sm text-gray-500 mt-1">{conversations.length} text conversations</p>
        </div>
        <button onClick={() => setShowNewMessage(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">+ New Text</button>
      </div>

      {loading ? <p className="text-gray-400 text-center py-10">Loading...</p> : conversations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">💬</p>
          <p className="text-gray-500">No conversations yet.</p>
          <p className="text-gray-400 text-sm mt-1">Start a text conversation with a contact.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map(c => (
            <div key={c.id} onClick={() => setActiveConvo(c)} className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-gray-800">{c.contactName}</h3>
                  <p className="text-sm text-gray-500">{c.contactPhone}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-100 text-green-700' : c.status === 'waiting' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.status || 'active'}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}</p>
                </div>
              </div>
              {c.lastMessage && <p className="text-sm text-gray-500 mt-2 truncate">{c.lastMessage}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTextMessage({ contacts, onDone }) {
  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [goal, setGoal] = useState('');
  const [generatedText, setGeneratedText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const filtered = contacts.filter(c => c.phone && (c.firstName + ' ' + c.lastName + ' ' + c.email).toLowerCase().includes(search.toLowerCase())).slice(0, 20);

  const generateText = async () => {
    if (!selectedContact || !goal) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${API}/api/ai/generate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: selectedContact, senderName: 'Amir', goal, conversationHistory: [] }),
      });
      const data = await res.json();
      if (data.text) setGeneratedText(data.text);
    } catch (e) {
      alert('AI generation failed: ' + e.message);
    }
    setAiLoading(false);
  };

  const sendText = async () => {
    if (!selectedContact || !generatedText) return;
    setSending(true);
    try {
      // Send SMS via backend
      await fetch(`${API}/api/send/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedContact.phone, text: generatedText, sender: 'NSPainters' }),
      });

      // Create conversation record in Firestore
      await addDoc(collection(db, CONVERSATIONS_COL), {
        userId: auth.currentUser.uid,
        contactId: selectedContact.id,
        contactName: selectedContact.firstName + ' ' + selectedContact.lastName,
        contactPhone: selectedContact.phone,
        contactEmail: selectedContact.email,
        messages: [{ from: 'Amir', text: generatedText, timestamp: new Date().toISOString() }],
        lastMessage: generatedText,
        status: 'waiting',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      alert('Text sent!');
      onDone();
    } catch (e) {
      alert('Failed to send: ' + e.message);
    }
    setSending(false);
  };

  return (
    <div>
      <button onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <h2 className="text-xl font-bold text-gray-800 mb-4">New Text Message</h2>

      {!selectedContact ? (
        <div>
          <input type="text" placeholder="Search contacts with phone numbers..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3" />
          <div className="space-y-2">
            {filtered.map(c => (
              <button key={c.id} onClick={() => setSelectedContact(c)}
                className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-300 transition">
                <p className="font-medium text-gray-800">{c.firstName} {c.lastName}</p>
                <p className="text-sm text-gray-500">{c.phone} · {c.address?.city || ''}</p>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-gray-400 text-center py-4">No contacts with phone numbers found.</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="font-medium text-gray-800">{selectedContact.firstName} {selectedContact.lastName}</p>
            <p className="text-sm text-gray-500">{selectedContact.phone} · {selectedContact.address?.city || ''}</p>
            <button onClick={() => setSelectedContact(null)} className="text-xs text-blue-600 mt-1">Change</button>
          </div>

          <div className="bg-purple-50 rounded-xl border border-purple-200 p-4">
            <p className="text-sm font-medium text-purple-800 mb-2">🤖 AI Text Generator</p>
            <input type="text" value={goal} onChange={e => setGoal(e.target.value)}
              placeholder="e.g., Check if they're thinking about painting this spring"
              className="w-full border border-purple-300 rounded-lg px-3 py-2 text-sm mb-2" />
            <button onClick={generateText} disabled={aiLoading || !goal}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {aiLoading ? '⏳ Generating...' : '✨ Generate Text'}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea value={generatedText} onChange={e => setGeneratedText(e.target.value)} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Type your text message or generate with AI above" />
            <p className="text-xs text-gray-400 mt-1">{generatedText.length}/300 characters</p>
          </div>

          <button onClick={sendText} disabled={sending || !generatedText}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-medium disabled:opacity-50">
            {sending ? 'Sending...' : '📱 Send Text Message'}
          </button>
        </div>
      )}
    </div>
  );
}

function ConvoThread({ convo, onBack }) {
  const [messages, setMessages] = useState(convo.messages || []);
  const [newReply, setNewReply] = useState('');
  const [incomingText, setIncomingText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Simulate incoming message + AI reply draft
  const handleIncoming = async () => {
    if (!incomingText.trim()) return;

    const updatedMessages = [...messages, { from: convo.contactName.split(' ')[0], text: incomingText, timestamp: new Date().toISOString() }];
    setMessages(updatedMessages);
    setIncomingText('');

    // Get AI draft reply
    setAiLoading(true);
    try {
      const res = await fetch(`${API}/api/ai/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: { firstName: convo.contactName.split(' ')[0], lastName: convo.contactName.split(' ')[1] || '', address: {} },
          senderName: 'Amir',
          incomingMessage: incomingText,
          conversationHistory: updatedMessages,
        }),
      });
      const data = await res.json();
      if (data.text) setNewReply(data.text);
    } catch (e) { console.error(e); }
    setAiLoading(false);
  };

  const sendReply = async () => {
    if (!newReply.trim()) return;
    setSending(true);
    try {
      await fetch(`${API}/api/send/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: convo.contactPhone, text: newReply, sender: 'NSPainters' }),
      });

      const updatedMessages = [...messages, { from: 'Amir', text: newReply, timestamp: new Date().toISOString() }];
      setMessages(updatedMessages);

      // Update Firestore
      await updateDoc(doc(db, CONVERSATIONS_COL, convo.id), {
        messages: updatedMessages,
        lastMessage: newReply,
        updatedAt: new Date().toISOString(),
        status: 'waiting',
      });

      setNewReply('');
    } catch (e) {
      alert('Send failed: ' + e.message);
    }
    setSending(false);
  };

  return (
    <div>
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 mb-4">← Back</button>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{convo.contactName}</h2>
          <p className="text-sm text-gray-500">{convo.contactPhone}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="bg-gray-50 rounded-xl p-4 mb-4 min-h-48 max-h-96 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.from === 'Amir' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${m.from === 'Amir' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
              <p>{m.text}</p>
              <p className={`text-xs mt-1 ${m.from === 'Amir' ? 'text-blue-200' : 'text-gray-400'}`}>
                {m.from} · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Log incoming reply (manual for now — auto in Phase 5) */}
      <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-3 mb-4">
        <p className="text-xs text-yellow-700 font-medium mb-2">📥 Log incoming reply (paste what they texted back)</p>
        <div className="flex gap-2">
          <input type="text" value={incomingText} onChange={e => setIncomingText(e.target.value)}
            placeholder="Paste their reply here..." className="flex-1 border border-yellow-300 rounded-lg px-3 py-2 text-sm" />
          <button onClick={handleIncoming} className="bg-yellow-500 text-white px-3 py-2 rounded-lg text-sm">Log + AI Reply</button>
        </div>
      </div>

      {/* AI-drafted reply */}
      {aiLoading && <p className="text-purple-600 text-sm mb-2">🤖 AI drafting reply...</p>}
      <div className="flex gap-2">
        <textarea value={newReply} onChange={e => setNewReply(e.target.value)} rows={2}
          placeholder="Type reply or let AI draft one..." className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={sendReply} disabled={sending || !newReply}
          className="bg-green-600 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-50 self-end">
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
