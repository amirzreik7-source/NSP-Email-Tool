import { useState } from 'react';
import LeadFinder from './LeadFinder';
import HotLeads from './HotLeads';
import Neighborhood from './Neighborhood';

export default function Leads() {
  const [tab, setTab] = useState('finder');

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('finder')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'finder' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>🔍 New Leads</button>
        <button onClick={() => setTab('hot')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'hot' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>🔥 Hot Contacts</button>
        <button onClick={() => setTab('nearby')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'nearby' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>📍 Nearby</button>
      </div>
      {tab === 'finder' && <LeadFinder />}
      {tab === 'hot' && <HotLeads />}
      {tab === 'nearby' && <Neighborhood />}
    </div>
  );
}
