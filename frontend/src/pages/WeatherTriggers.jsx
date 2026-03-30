import { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { getAllContacts } from '../lib/contacts';

const API = import.meta.env.VITE_API_URL || '';

export default function WeatherTriggers() {
  const [alerts, setAlerts] = useState([]);
  const [allCities, setAllCities] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => { loadContacts(); }, []);

  const loadContacts = async () => {
    const data = await getAllContacts(auth.currentUser.uid);
    setContacts(data);
    setLoading(false);
  };

  const checkWeather = async () => {
    setChecking(true);
    const cities = [...new Set(contacts.map(c => c.address?.city).filter(Boolean))];
    try {
      const res = await fetch(`${API}/api/weather/check-cities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cities }),
      });
      const data = await res.json();
      setAlerts(data.alerts || []);
      setAllCities(data.allCities || []);
    } catch(e) { alert('Weather check failed: ' + e.message); }
    setChecking(false);
  };

  const getContactCountForCity = (city) => contacts.filter(c => c.address?.city === city).length;
  const getExteriorCountForCity = (city) => contacts.filter(c => c.address?.city === city && c.jobHistory?.some(j => j.jobType === 'Exterior')).length;

  if (loading) return <p className="text-gray-400 text-center py-10">Loading...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🌤️ Weather Triggers</h1>
          <p className="text-sm text-gray-500">Detect perfect painting weather and launch campaigns</p>
        </div>
        <button onClick={checkWeather} disabled={checking} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {checking ? '⏳ Checking...' : '🌤️ Check Weather Now'}
        </button>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-3 mb-6">
          {alerts.map(alert => (
            <div key={alert.city} className="bg-green-50 border border-green-200 rounded-xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-green-800 text-lg">🌤️ Perfect painting weather in {alert.city}!</h3>
                  <p className="text-sm text-green-600 mt-1">{alert.perfectDays} consecutive days · {alert.tempRange} · No rain</p>
                  <p className="text-sm text-gray-600 mt-2">{getContactCountForCity(alert.city)} contacts in {alert.city} · {getExteriorCountForCity(alert.city)} with exterior history</p>
                </div>
                <button onClick={() => window.location.href = '/ai-campaign'} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Launch Campaign →
                </button>
              </div>
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {alert.details?.map(d => (
                  <div key={d.date} className={`flex-shrink-0 rounded-lg p-2 text-center text-xs ${d.perfect ? 'bg-green-100' : 'bg-red-50'}`}>
                    <p className="font-medium">{new Date(d.date).toLocaleDateString('en', { weekday: 'short' })}</p>
                    <p>{Math.round(d.high)}°</p>
                    <p className="text-gray-400">{d.rain > 0 ? '🌧️' : '☀️'}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {allCities.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-700 mb-3">All Cities — 7 Day Forecast</h3>
          <div className="space-y-2">
            {allCities.map(city => (
              <div key={city.city} className="flex items-center justify-between py-2 border-b border-gray-50">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${city.isPaintingWeather ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-sm font-medium text-gray-800">{city.city}</span>
                  <span className="text-xs text-gray-400">{getContactCountForCity(city.city)} contacts</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{city.tempRange}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${city.isPaintingWeather ? 'bg-green-100 text-green-700' : city.perfectDays >= 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                    {city.perfectDays}d perfect
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allCities.length === 0 && !checking && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-3">🌤️</p>
          <p className="text-gray-500">Click "Check Weather Now" to scan forecast for all your contact cities</p>
        </div>
      )}
    </div>
  );
}
