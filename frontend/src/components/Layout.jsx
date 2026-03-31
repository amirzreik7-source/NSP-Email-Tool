import { NavLink, Outlet } from 'react-router-dom';
import { auth, signOut } from '../lib/firebase';

const navItems = [
  { to: '/', icon: '⭐', label: 'Today' },
  { to: '/leads', icon: '🔍', label: 'Leads' },
  { to: '/campaigns', icon: '📧', label: 'Campaigns' },
  { to: '/contacts', icon: '👥', label: 'Contacts' },
  { to: '/conversations', icon: '💬', label: 'Conversations' },
  { to: '/reports', icon: '📊', label: 'Reports' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-52 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-100">
          <p className="text-base font-bold text-gray-800">⭐ Northern Star</p>
          <p className="text-xs text-gray-400">Sales Intelligence Hub</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'}`}>
              <span>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-100">
          <button onClick={() => signOut(auth)} className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-red-500 transition">Sign Out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
    </div>
  );
}
