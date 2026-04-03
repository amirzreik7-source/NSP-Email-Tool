import { useState } from 'react';
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '../lib/firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setLoading(true);

    // Try multiple password formats (format changed between phases)
    const passwords = [
      'northern-star-' + email.replace(/[^a-zA-Z0-9]/g, ''),
      'northern-star-' + email.toLowerCase().replace(/[^a-zA-Z0-9]/g, ''),
      'nsp-' + email.toLowerCase().replace(/[^a-zA-Z0-9]/g, ''),
    ];

    let loggedIn = false;
    for (const password of passwords) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
        loggedIn = true;
        break;
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          // Account doesn't exist — create with first password format
          try {
            await createUserWithEmailAndPassword(auth, email, passwords[0]);
            loggedIn = true;
          } catch (createErr) {
            setError('Could not create account: ' + createErr.message);
          }
          break;
        }
        // Otherwise try next password
      }
    }

    if (!loggedIn && !error) {
      setError('Could not sign in. Your account exists but the password has changed. Use a new email or reset in Firebase Console.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-3xl">⭐</p>
          <h1 className="text-xl font-bold text-gray-800 mt-2">Northern Star Painters</h1>
          <p className="text-gray-400 text-sm mt-1">Email Marketing Tool</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="your@email.com"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium text-sm hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
