import { NavLink, Outlet } from 'react-router-dom';
import { auth, signOut } from '../lib/firebase';

const navItems = [
  { to: '/', icon: '📊', label: 'Dashboard' },
  { to: '/lead-finder', icon: '🔍', label: 'Lead Finder' },
  { to: '/hot-leads', icon: '🔥', label: 'Hot Leads' },
  { to: '/pipeline', icon: '🗺️', label: 'Pipeline' },
  { to: '/approval-queue', icon: '✅', label: 'Queue' },
  { to: '/lists', icon: '📋', label: 'Lists' },
  { to: '/contacts', icon: '👥', label: 'Contacts' },
  { to: '/campaigns', icon: '📧', label: 'Campaigns' },
  { to: '/ai-campaign', icon: '🤖', label: 'AI Campaign' },
  { to: '/conversations', icon: '💬', label: 'Texts' },
  { to: '/follow-ups', icon: '📋', label: 'Follow-Ups' },
  { to: '/neighborhood', icon: '📍', label: 'Neighborhood' },
  { to: '/weather', icon: '🌤️', label: 'Weather' },
  { to: '/intelligence', icon: '🧠', label: 'Intelligence' },
  { to: '/referrals', icon: '🔗', label: 'Referrals' },
  { to: '/voice', icon: '🎤', label: 'Voice Learning' },
  { to: '/saturday-night', icon: '🌙', label: 'Auto-Respond' },
  { to: '/ad-export', icon: '📤', label: 'Ad Export' },
  { to: '/system-health', icon: '🔧', label: 'System Health' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-48 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-100">
          <p className="text-base font-bold text-gray-800">⭐ NSP Hub</p>
          <p className="text-xs text-gray-400">Northern Star</p>
        </div>
        <nav className="flex-1 p-1.5 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span className="text-xs">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-100">
          <button onClick={() => signOut(auth)} className="w-full text-left px-2.5 py-1.5 text-xs text-gray-400 hover:text-red-500">Sign Out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
    </div>
  );
}
