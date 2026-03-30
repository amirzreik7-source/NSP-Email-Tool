export default function Settings() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Settings</h1>
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-700 mb-2">Sender Accounts</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <div>
                <p className="font-medium text-gray-800">Amir Zreik</p>
                <p className="text-gray-400">amirz@northernstarpainters.com</p>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Personal</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <div>
                <p className="font-medium text-gray-800">Mary Johnson</p>
                <p className="text-gray-400">mary@northernstarpainters.com</p>
              </div>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Professional</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-700 mb-2">Sending Services</h2>
          <div className="text-sm text-gray-500 space-y-1">
            <p>Brevo API — <span className="text-gray-400">Not configured</span></p>
            <p>Titan SMTP — <span className="text-gray-400">Not configured</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
