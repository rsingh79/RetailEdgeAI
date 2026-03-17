export default function Pricing() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pricing Rules</h2>
          <p className="text-sm text-gray-500 mt-1">Configure margin targets, markup rules, and rounding strategies</p>
        </div>
        <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
          + Add Rule
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
        Pricing rule cards will go here
      </div>
    </div>
  );
}
