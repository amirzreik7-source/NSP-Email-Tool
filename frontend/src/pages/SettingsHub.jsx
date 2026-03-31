import { useState } from 'react';
import Settings from './Settings';
import SystemHealth from './SystemHealth';
import VoiceLearning from './VoiceLearning';
import AdExport from './AdExport';
import WeatherTriggers from './WeatherTriggers';

export default function SettingsHub() {
  const [section, setSection] = useState('accounts');

  const sections = [
    { id: 'accounts', label: '⚙️ Accounts', component: Settings },
    { id: 'health', label: '🔧 System Health', component: SystemHealth },
    { id: 'ads', label: '📤 Ad Export', component: AdExport },
    { id: 'voice', label: '🎤 Voice Learning', component: VoiceLearning },
    { id: 'weather', label: '🌤️ Weather', component: WeatherTriggers },
  ];

  const ActiveComponent = sections.find(s => s.id === section)?.component || Settings;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-4">⚙️ Settings</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {sections.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${section === s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <ActiveComponent />
    </div>
  );
}
