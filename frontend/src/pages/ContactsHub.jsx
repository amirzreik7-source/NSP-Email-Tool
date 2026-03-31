import { useState } from 'react';
import Contacts from './Contacts';
import Lists from './Lists';

export default function ContactsHub() {
  const [tab, setTab] = useState('contacts');

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('contacts')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'contacts' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>👥 All Contacts</button>
        <button onClick={() => setTab('lists')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'lists' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>📋 Lists</button>
      </div>
      {tab === 'contacts' && <Contacts />}
      {tab === 'lists' && <Lists />}
    </div>
  );
}
