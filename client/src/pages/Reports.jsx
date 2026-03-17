export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Reports & Analytics</h2>
        <p className="text-sm text-gray-500 mt-1">Monitor cost movements, margin health, and supplier trends</p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        {['Cost Changes', 'Margin Risk', 'Supplier Analysis', 'Price Competitiveness'].map((r) => (
          <div key={r} className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 h-48 flex items-center justify-center">
            {r} dashboard will go here
          </div>
        ))}
      </div>
    </div>
  );
}
