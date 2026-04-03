import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function TrackingSettings() {
  const [settings, setSettings] = useState({
    uniqueLinksEnabled: true,
    openPixelEnabled: true,
    websiteTrackingEnabled: false,
    googleAnalyticsId: '',
    websiteScriptInstalled: false,
  });
  const [saving, setSaving] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/tracking/settings`).then(r => r.json()).then(setSettings).catch(() => {});
  }, []);

  const save = async (updates) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    setSaving(true);
    try {
      await fetch(`${API}/api/tracking/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (e) {}
    setSaving(false);
  };

  const trackingScript = `<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var uid = params.get('uid');
  var cid = params.get('cid');
  if (uid && cid) {
    fetch('https://nsp-email-tool-production.up.railway.app/api/track/pageview-p7', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        contactId: uid,
        campaignId: cid,
        page: window.location.pathname,
        timestamp: new Date().toISOString()
      })
    });
  }
})();
</script>`;

  const copyScript = () => {
    navigator.clipboard.writeText(trackingScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Tracking & Analytics</h2>
        <p className="text-sm text-gray-500">Configure once. Works automatically on every campaign.</p>
      </div>

      {/* Unique Link Tracking */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Unique Link Tracking</h3>
            <p className="text-sm text-gray-500 mt-1">Every link gets a unique per-contact identifier. When Sarah clicks, your system knows it's Sarah specifically.</p>
            <p className="text-xs text-gray-400 mt-1">Applied to: all campaigns automatically</p>
          </div>
          <button onClick={() => save({ uniqueLinksEnabled: !settings.uniqueLinksEnabled })}
            className={`w-14 h-7 rounded-full relative transition ${settings.uniqueLinksEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
            <span className={`block w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${settings.uniqueLinksEnabled ? 'left-8' : 'left-1'}`} />
          </button>
        </div>
      </div>

      {/* Open Tracking Pixel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Open Tracking Pixel</h3>
            <p className="text-sm text-gray-500 mt-1">A tiny invisible image in every email detects when someone opens it.</p>
            <p className="text-xs text-amber-600 mt-1">Note: Apple Mail users may show as opened automatically due to Apple's privacy settings.</p>
            <p className="text-xs text-gray-400 mt-1">Applied to: all campaigns automatically</p>
          </div>
          <button onClick={() => save({ openPixelEnabled: !settings.openPixelEnabled })}
            className={`w-14 h-7 rounded-full relative transition ${settings.openPixelEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
            <span className={`block w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${settings.openPixelEnabled ? 'left-8' : 'left-1'}`} />
          </button>
        </div>
      </div>

      {/* Website Visit Tracking */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Website Visit Tracking</h3>
            <p className="text-sm text-gray-500 mt-1">Tracks which contacts visit your website after clicking an email link.</p>
            <p className="text-xs text-gray-400 mt-1">Requires: tracking script on northernstarpainters.com</p>
          </div>
          <button onClick={() => save({ websiteTrackingEnabled: !settings.websiteTrackingEnabled })}
            className={`w-14 h-7 rounded-full relative transition ${settings.websiteTrackingEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
            <span className={`block w-5 h-5 bg-white rounded-full absolute top-1 transition-all ${settings.websiteTrackingEnabled ? 'left-8' : 'left-1'}`} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${settings.websiteScriptInstalled ? 'text-green-600' : 'text-amber-600'}`}>
            Status: {settings.websiteScriptInstalled ? '✅ Active' : '⚠️ Script not yet installed'}
          </span>
          <button onClick={() => setShowScript(!showScript)} className="text-sm text-blue-600 hover:underline">
            {showScript ? 'Hide Instructions' : 'View Installation Instructions'}
          </button>
        </div>

        {showScript && (
          <div className="mt-4 bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-800 mb-2">Website Tracking Setup</h4>
            <p className="text-sm text-gray-600 mb-3">Copy this script and paste it into the &lt;head&gt; section of your website (northernstarpainters.com). Ask your web developer or paste it yourself in your website builder's custom code section.</p>
            <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">{trackingScript}</pre>
            <p className="text-sm text-gray-600 mt-3">Once installed, this script runs silently on every page of your website. When a contact clicks a link from your email and lands on your site, their visit gets logged automatically.</p>
            <div className="flex gap-2 mt-3">
              <button onClick={copyScript} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                {copied ? '✓ Copied!' : 'Copy Script'}
              </button>
              <button onClick={() => save({ websiteScriptInstalled: true })} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium">
                Mark as Installed
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Google Analytics */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800">Google Analytics Integration</h3>
        <p className="text-sm text-gray-500 mt-1">When connected, website visits sync with Google Analytics for retargeting capabilities.</p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={settings.googleAnalyticsId}
            onChange={e => setSettings({ ...settings, googleAnalyticsId: e.target.value })}
            placeholder="G-XXXXXXXXXX"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={() => save({ googleAnalyticsId: settings.googleAnalyticsId })} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
            Save
          </button>
        </div>
        <p className={`text-xs mt-2 ${settings.googleAnalyticsId ? 'text-green-600' : 'text-gray-400'}`}>
          Status: {settings.googleAnalyticsId ? `✅ Connected (${settings.googleAnalyticsId})` : 'Not connected'}
        </p>
      </div>

      {saving && <p className="text-xs text-blue-500 text-center">Saving...</p>}
    </div>
  );
}
