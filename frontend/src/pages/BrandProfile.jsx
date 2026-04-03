import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || '';

export default function BrandProfile() {
  const [profile, setProfile] = useState({
    companyName: 'Northern Star Painters',
    primaryColor: '#1e3a8a',
    secondaryColor: '#ffffff',
    logoUrl: '',
    address: '4600 South Four Mile Run Drive, Arlington, VA 22204',
    phone: '(202) 743-5072',
    website: 'northernstarpainters.com',
    tagline: 'Professional Painting Services',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/brand-profile`).then(r => r.json()).then(data => {
      if (data && data.companyName) setProfile(data);
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/api/brand-profile`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Logo must be under 2MB'); return; }
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) { alert('PNG, JPG, or SVG only'); return; }

    setUploading(true);
    try {
      // Convert to base64 data URL for simple storage
      const reader = new FileReader();
      reader.onload = () => {
        setProfile(prev => ({ ...prev, logoUrl: reader.result }));
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (e) {
      alert('Upload failed: ' + e.message);
      setUploading(false);
    }
  };

  // Generate a simple footer preview
  const footerPreview = `${profile.companyName} | ${profile.address}${profile.phone ? ' | ' + profile.phone : ''}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Brand Profile</h2>
        <p className="text-sm text-gray-500">Set your company branding. Used in Soft Branded and Campaign style emails.</p>
      </div>

      {/* Company Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
          <input type="text" value={profile.companyName} onChange={e => setProfile({ ...profile, companyName: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
          <input type="text" value={profile.tagline} onChange={e => setProfile({ ...profile, tagline: e.target.value })}
            placeholder="Professional Painting Services"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={profile.primaryColor} onChange={e => setProfile({ ...profile, primaryColor: e.target.value })}
                className="w-10 h-10 rounded border cursor-pointer" />
              <input type="text" value={profile.primaryColor} onChange={e => setProfile({ ...profile, primaryColor: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={profile.secondaryColor} onChange={e => setProfile({ ...profile, secondaryColor: e.target.value })}
                className="w-10 h-10 rounded border cursor-pointer" />
              <input type="text" value={profile.secondaryColor} onChange={e => setProfile({ ...profile, secondaryColor: e.target.value })}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
        </div>
      </div>

      {/* Logo */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
        {profile.logoUrl ? (
          <div className="flex items-center gap-4 mb-3">
            <img src={profile.logoUrl} alt="Logo" className="max-w-48 max-h-16 object-contain bg-gray-50 rounded p-2" />
            <button onClick={() => setProfile({ ...profile, logoUrl: '' })} className="text-xs text-red-600 hover:underline">Remove</button>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-2">No logo uploaded</p>
        )}
        <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm cursor-pointer hover:bg-blue-700">
          {uploading ? 'Uploading...' : 'Upload Logo'}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
        </label>
        <p className="text-xs text-gray-400 mt-2">PNG, JPG, or SVG. Max 2MB. Recommended: 300x80px with transparent background.</p>
      </div>

      {/* Contact Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Address</label>
          <input type="text" value={profile.address} onChange={e => setProfile({ ...profile, address: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input type="text" value={profile.website} onChange={e => setProfile({ ...profile, website: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Footer Preview */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Email Footer Preview</h3>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-500">{footerPreview}</p>
          <p className="text-xs text-blue-500 mt-1">Unsubscribe</p>
        </div>
        <div className="mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Campaign Header Preview</h3>
          <div style={{ background: profile.primaryColor }} className="rounded-lg p-6 text-center">
            {profile.logoUrl && <img src={profile.logoUrl} alt="" className="max-w-48 max-h-12 mx-auto mb-2 object-contain" />}
            <h2 className="text-lg font-bold text-white">{profile.companyName}</h2>
            <p className="text-xs text-white/70 mt-1">{profile.tagline}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Brand Profile'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </div>
  );
}
