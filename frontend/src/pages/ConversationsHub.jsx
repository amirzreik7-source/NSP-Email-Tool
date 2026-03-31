import { useState } from 'react';
import Conversations from './Conversations';
import FollowUps from './FollowUps';
import ApprovalQueue from './ApprovalQueue';

export default function ConversationsHub() {
  const [tab, setTab] = useState('queue');

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('queue')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'queue' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>✅ Approval Queue</button>
        <button onClick={() => setTab('texts')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'texts' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>💬 Texts</button>
        <button onClick={() => setTab('sequences')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'sequences' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>📋 Sequences</button>
      </div>
      {tab === 'queue' && <ApprovalQueue />}
      {tab === 'texts' && <Conversations />}
      {tab === 'sequences' && <FollowUps />}
    </div>
  );
}
