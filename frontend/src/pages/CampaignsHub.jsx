import { useState } from 'react';
import Campaigns from './Campaigns';
import AICampaign from './AICampaign';

export default function CampaignsHub() {
  const [mode, setMode] = useState(null); // null = choose, 'ai' = AI, 'manual' = regular

  if (mode === 'ai') return <div><button onClick={() => setMode(null)} className="text-sm text-gray-500 mb-4">← Back to Campaigns</button><AICampaign /></div>;
  if (mode === 'manual') return <div><button onClick={() => setMode(null)} className="text-sm text-gray-500 mb-4">← Back to Campaigns</button><Campaigns /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">📧 Campaigns</h1>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button onClick={() => setMode('ai')} className="bg-purple-50 border-2 border-purple-200 rounded-xl p-5 text-left hover:shadow-md transition hover:border-purple-400">
          <p className="text-2xl mb-2">🤖</p>
          <h3 className="font-semibold text-gray-800">AI Campaign</h3>
          <p className="text-sm text-gray-500 mt-1">AI writes a unique email for every contact based on their profile</p>
          <p className="text-xs text-purple-600 mt-2 font-medium">Best for personalized outreach →</p>
        </button>
        <button onClick={() => setMode('manual')} className="bg-blue-50 border-2 border-blue-200 rounded-xl p-5 text-left hover:shadow-md transition hover:border-blue-400">
          <p className="text-2xl mb-2">✏️</p>
          <h3 className="font-semibold text-gray-800">Manual Campaign</h3>
          <p className="text-sm text-gray-500 mt-1">Write your own email with AI assistance and personalization fields</p>
          <p className="text-xs text-blue-600 mt-2 font-medium">Best for announcements & offers →</p>
        </button>
      </div>

      {/* Show past campaigns below */}
      <Campaigns />
    </div>
  );
}
