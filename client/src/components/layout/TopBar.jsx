import { useLocation } from 'react-router-dom';

const titles = {
  '/': 'Dashboard',
  '/ai': 'AI Command Center',
  '/invoices': 'Upload Invoices',
  '/review': 'Invoice Review',
  '/products': 'Product Catalog',
  '/pricing': 'Pricing Rules',
  '/reports': 'Reports & Analytics',
  '/settings': 'Settings',
  '/competitor': 'Competitor Intelligence',
  '/connect': 'Connect & Integrate',
  '/export': 'Export',
};

export default function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] || 'RetailEdge';

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="relative">
          <input
            type="text"
            placeholder="Search products, invoices..."
            className="w-72 pl-10 pr-4 py-2 bg-gray-100 border-0 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:bg-white"
          />
          <svg
            className="w-4 h-4 text-gray-400 absolute left-3 top-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button className="relative p-2 text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
      </div>
    </header>
  );
}
