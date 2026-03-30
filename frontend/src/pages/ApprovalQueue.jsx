import { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';

const API = import.meta.env.VITE_API_URL || '';

export default function ApprovalQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const uid = auth.currentUser.uid;
    // Load from followUpSequences where steps are pending
    const seqSnap = await getDocs(query(collection(db, 'followUpSequences'), where('userId', '==', uid), where('status', '==', 'active')));
    const sequences = seqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Find steps due today or overdue
    const today = new Date();
    const pending = [];

    sequences.forEach(seq => {
      const startDate = new Date(seq.startDate);
      seq.steps.forEach((step, idx) => {
        if (step.completed) return;
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + step.day);
        if (dueDate <= today) {
          pending.push({
            seqId: seq.id,
            stepIndex: idx,
            contactName: seq.contactName,
            contactEmail: seq.contactEmail,
            contactPhone: seq.contactPhone,
            templateName: seq.templateName,
            channel: step.channel,
            goal: step.goal,
            day: step.day,
            dueDate: dueDate.toISOString(),
            aiDraft: step.aiDraft || null,
          });
        }
      });
    });

    // Sort by due date
    pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    setItems(pending);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateDraft = async (item, idx) => {
    const updatedItems = [...items];
    updatedItems[idx] = { ...item, generating: true };
    setItems(updatedItems);

    try {
      const endpoint = item.channel === 'text' ? '/api/ai/generate-text' : '/api/ai/generate-email';
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: { firstName: item.contactName.split(' ')[0], lastName: item.contactName.split(' ').slice(1).join(' '), address: {} },
          senderName: 'Amir',
          goal: item.goal,
          conversationHistory: [],
          persona: '',
          tone: 'warm_personal',
          personalizationFields: ['{FirstName}', '{City}'],
        }),
      });
      const data = await res.json();
      updatedItems[idx] = { ...item, generating: false, aiDraft: data.text || data.bodyText || data.bodyHTML || '' };
      setItems(updatedItems);
    } catch(e) {
      updatedItems[idx] = { ...item, generating: false };
      setItems(updatedItems);
    }
  };

  const approveAndSend = async (item, idx) => {
    const draft = item.aiDraft;
    if (!draft) return;

    try {
      if (item.channel === 'text' && item.contactPhone) {
        await fetch(`${API}/api/send/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: item.contactPhone, text: draft, sender: 'NSPainters' }),
        });
      } else {
        await fetch(`${API}/api/send/brevo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromEmail: 'amirz@northernstarpainters.com', fromName: 'Amir Zreik', toEmail: item.contactEmail, toName: item.contactName, subject: `Following up — ${item.contactName.split(' ')[0]}`, htmlContent: `<p>${draft}</p>`, textContent: draft }),
        });
      }

      // Mark step as completed in Firestore
      const seqRef = doc(db, 'followUpSequences', item.seqId);
      const seqSnap = await getDocs(query(collection(db, 'followUpSequences'), where('userId', '==', auth.currentUser.uid)));
      const seqDoc = seqSnap.docs.find(d => d.id === item.seqId);
      if (seqDoc) {
        const steps = seqDoc.data().steps;
        steps[item.stepIndex] = { ...steps[item.stepIndex], completed: true, completedAt: new Date().toISOString(), sentMessage: draft };
        await updateDoc(seqRef, { steps });
      }

      // Remove from queue
      setItems(prev => prev.filter((_, i) => i !== idx));
    } catch(e) {
      alert('Send failed: ' + e.message);
    }
  };

  const skip = async (item, idx) => {
    const seqRef = doc(db, 'followUpSequences', item.seqId);
    const seqSnap = await getDocs(query(collection(db, 'followUpSequences'), where('userId', '==', auth.currentUser.uid)));
    const seqDoc = seqSnap.docs.find(d => d.id === item.seqId);
    if (seqDoc) {
      const steps = seqDoc.data().steps;
      steps[item.stepIndex] = { ...steps[item.stepIndex], completed: true, skipped: true };
      await updateDoc(seqRef, { steps });
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  if (loading) return <p className="text-gray-400 text-center py-10">Loading queue...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">✅ Approval Queue</h1>
        <p className="text-sm text-gray-500 mt-1">{items.length} message{items.length !== 1 ? 's' : ''} waiting for approval</p>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-gray-500">All caught up! No messages pending.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{item.contactName}</h3>
                  <p className="text-sm text-gray-500">{item.templateName} · Day {item.day} · {item.channel === 'text' ? '💬 Text' : '📧 Email'}</p>
                </div>
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">Pending</span>
              </div>

              <p className="text-sm text-gray-600 mb-3"><strong>Goal:</strong> {item.goal}</p>

              {item.aiDraft ? (
                <div className="bg-blue-50 rounded-lg p-3 mb-3">
                  <p className="text-xs text-blue-600 font-medium mb-1">AI Draft:</p>
                  <p className="text-sm text-gray-800">{item.aiDraft}</p>
                </div>
              ) : (
                <button onClick={() => generateDraft(item, idx)} disabled={item.generating}
                  className="bg-purple-100 text-purple-700 px-3 py-2 rounded-lg text-sm mb-3 disabled:opacity-50">
                  {item.generating ? '⏳ Generating...' : '🤖 Generate AI Draft'}
                </button>
              )}

              <div className="flex gap-2">
                <button onClick={() => approveAndSend(item, idx)} disabled={!item.aiDraft}
                  className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  ✓ Approve & Send
                </button>
                <button onClick={() => skip(item, idx)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600">
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
