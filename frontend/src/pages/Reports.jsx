import { useState } from 'react';
import Dashboard from './Dashboard';
import Pipeline from './Pipeline';
import Intelligence from './Intelligence';
import Referrals from './Referrals';

export default function Reports() {
  const [tab, setTab] = useState('overview');

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('overview')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'overview' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>📊 Overview</button>
        <button onClick={() => setTab('pipeline')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'pipeline' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>🗺️ Pipeline</button>
        <button onClick={() => setTab('intelligence')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'intelligence' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>🧠 Intelligence</button>
        <button onClick={() => setTab('referrals')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'referrals' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>🔗 Referrals</button>
      </div>
      {tab === 'overview' && <Dashboard />}
      {tab === 'pipeline' && <Pipeline />}
      {tab === 'intelligence' && <Intelligence />}
      {tab === 'referrals' && <Referrals />}
    </div>
  );
}
