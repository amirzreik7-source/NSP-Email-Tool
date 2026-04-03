import { useState } from 'react';
import Contacts from './Contacts';
import Lists from './Lists';
import HotContacts from './HotContacts';
import NearbyContacts from './NearbyContacts';

export default function ContactsHub() {
  const [tab, setTab] = useState('contacts');

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { id: 'contacts', label: '👥 All Contacts' },
          { id: 'lists', label: '📋 Lists' },
          { id: 'hot', label: '🔥 Hot Contacts' },
          { id: 'nearby', label: '📍 Nearby' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'contacts' && <Contacts />}
      {tab === 'lists' && <Lists />}
      {tab === 'hot' && <HotContacts />}
      {tab === 'nearby' && <NearbyContacts />}
    </div>
  );
}
