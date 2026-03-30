import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, getDocs, query, where, setDoc, doc, getDoc } from 'firebase/firestore';

const API = import.meta.env.VITE_API_URL || '';

export default function VoiceLearning() {
  const [profile, setProfile] = useState(null);
  const [editCount, setEditCount] = useState(0);
  const [recentEdits, setRecentEdits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    (async () => {
      const uid = auth.currentUser.uid;
      // Load voice profile
      const profDoc = await getDoc(doc(db, 'voiceProfile', uid));
      if (profDoc.exists()) setProfile(profDoc.data());
      // Load edit count
      const editsSnap = await getDocs(query(collection(db, 'voiceEdits'), where('userId', '==', uid)));
      const edits = editsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setEditCount(edits.length);
      setRecentEdits(edits.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 10));
      setLoading(false);
    })();
  }, []);

  const runAnalysis = async () => {
    setAnalyzing(true);
    const uid = auth.currentUser.uid;
    const editsSnap = await getDocs(query(collection(db, 'voiceEdits'), where('userId', '==', uid)));
    const edits = editsSnap.docs.map(d => d.data());

    try {
      const res = await fetch(`${API}/api/voice/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits }),
      });
      const voiceProfile = await res.json();
      await setDoc(doc(db, 'voiceProfile', uid), { ...voiceProfile, updatedAt: new Date().toISOString(), editCount: edits.length });
      setProfile(voiceProfile);
    } catch(e) { alert('Analysis failed: ' + e.message); }
    setAnalyzing(false);
  };

  // Calculate no-edit rate
  const noEditRate = editCount > 0 && profile ? Math.round((profile.noEditCount || 0) / editCount * 100) : 0;

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">🎤 Voice Learning</h1>
      <p className="text-sm text-gray-500 mb-6">Claude learns your writing style from every edit you make</p>

      {/* Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-700">Learning Progress</h3>
          <span className="text-sm text-gray-500">{editCount} edits logged</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div className="bg-purple-600 h-3 rounded-full transition-all" style={{ width: `${Math.min(100, (editCount / 200) * 100)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>0</span>
          <span className={editCount >= 20 ? 'text-purple-600 font-medium' : ''}>20 (learning starts)</span>
          <span className={editCount >= 50 ? 'text-purple-600 font-medium' : ''}>50</span>
          <span className={editCount >= 100 ? 'text-purple-600 font-medium' : ''}>100</span>
          <span className={editCount >= 200 ? 'text-purple-600 font-medium' : ''}>200 (mastery)</span>
        </div>
        <p className="text-sm text-gray-600 mt-3">
          {editCount < 20 ? '📝 Keep editing AI messages — Claude needs 20+ examples to start learning your voice.' :
           editCount < 50 ? '🧠 Claude is learning your voice. Messages needing no edits will increase.' :
           editCount < 100 ? `📈 Getting better! ${noEditRate}% of messages need no edits.` :
           editCount < 200 ? `🎯 Strong voice match. ${noEditRate}% accuracy.` :
           `✨ Voice mastery achieved. ${noEditRate}% accuracy.`}
        </p>
      </div>

      {/* Voice Profile */}
      {profile ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-700">Your Voice Profile</h3>
            <button onClick={runAnalysis} disabled={analyzing || editCount < 20}
              className="text-sm text-purple-600 hover:underline disabled:opacity-50">
              {analyzing ? 'Analyzing...' : '🔄 Re-analyze'}
            </button>
          </div>

          {profile.summary && <p className="text-sm text-gray-600 mb-4 italic">"{profile.summary}"</p>}

          <div className="grid grid-cols-2 gap-4">
            {profile.preferredGreetings?.length > 0 && (
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-medium mb-1">Preferred Greetings</p>
                <div className="flex flex-wrap gap-1">{profile.preferredGreetings.map((g, i) => <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{g}</span>)}</div>
              </div>
            )}
            {profile.wordsToAvoid?.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-medium mb-1">Words to Avoid</p>
                <div className="flex flex-wrap gap-1">{profile.wordsToAvoid.map((w, i) => <span key={i} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{w}</span>)}</div>
              </div>
            )}
            {profile.wordsPreferred?.length > 0 && (
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-medium mb-1">Words You Use</p>
                <div className="flex flex-wrap gap-1">{profile.wordsPreferred.map((w, i) => <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{w}</span>)}</div>
              </div>
            )}
            {profile.toneDescriptors?.length > 0 && (
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 font-medium mb-1">Your Tone</p>
                <div className="flex flex-wrap gap-1">{profile.toneDescriptors.map((t, i) => <span key={i} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{t}</span>)}</div>
              </div>
            )}
          </div>
        </div>
      ) : editCount >= 20 ? (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 mb-6 text-center">
          <p className="font-medium text-purple-800">Ready to analyze your voice!</p>
          <p className="text-sm text-purple-600 mt-1">{editCount} edits logged — enough data to build your profile.</p>
          <button onClick={runAnalysis} disabled={analyzing} className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {analyzing ? '⏳ Analyzing...' : '🤖 Build Voice Profile'}
          </button>
        </div>
      ) : null}

      {/* Recent edits */}
      {recentEdits.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Recent Edits</h3>
          <div className="space-y-3">
            {recentEdits.map(edit => (
              <div key={edit.id} className="border-b border-gray-50 pb-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-red-50 rounded-lg p-2">
                    <p className="text-xs text-red-500 font-medium mb-1">AI Original:</p>
                    <p className="text-xs text-gray-600 line-clamp-3">{edit.original}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-2">
                    <p className="text-xs text-green-500 font-medium mb-1">Your Edit:</p>
                    <p className="text-xs text-gray-600 line-clamp-3">{edit.edited}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">{edit.timestamp ? new Date(edit.timestamp).toLocaleDateString() : ''} · {edit.type || 'email'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
