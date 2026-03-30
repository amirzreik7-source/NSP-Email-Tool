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

    const password = 'northern-star-' + email.replace(/[^a-zA-Z0-9]/g, '');

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, email, password);
        } catch (createErr) {
          setError('Login failed: ' + createErr.message);
        }
      } else {
        setError('Login failed: ' + err.message);
      }
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
