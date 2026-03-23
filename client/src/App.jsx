import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import AdminLayout from './components/layout/AdminLayout';
import Dashboard from './pages/Dashboard';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Review from './pages/Review';
import BatchReview from './pages/BatchReview';
import Export from './pages/Export';
import Products from './pages/Products';
import Pricing from './pages/Pricing';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import CompetitorIntelligence from './pages/CompetitorIntelligence';
import AICommandCenter from './pages/AICommandCenter';
import BusinessAdvisor from './pages/BusinessAdvisor';
import ConnectWizard from './pages/ConnectWizard';
import Login from './pages/Login';
import AdminOverview from './pages/admin/Overview';
import AdminTenants from './pages/admin/Tenants';
import AdminTenantDetail from './pages/admin/TenantDetail';
import AdminApiUsage from './pages/admin/ApiUsage';
import AdminSubscriptions from './pages/admin/Subscriptions';
import AdminProductSetup from './pages/admin/ProductSetup';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="ai" element={<AICommandCenter />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/:invoiceId" element={<InvoiceDetail />} />
          <Route path="review" element={<BatchReview />} />
          <Route path="review/:invoiceId" element={<Review />} />
          <Route path="export" element={<Export />} />
          <Route path="products" element={<Products />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="reports" element={<Reports />} />
          <Route path="advisor" element={<BusinessAdvisor />} />
          <Route path="competitor" element={<CompetitorIntelligence />} />
          <Route path="connect" element={<ConnectWizard />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/overview" replace />} />
          <Route path="overview" element={<AdminOverview />} />
          <Route path="tenants" element={<AdminTenants />} />
          <Route path="tenants/:id" element={<AdminTenantDetail />} />
          <Route path="api-usage" element={<AdminApiUsage />} />
          <Route path="subscriptions" element={<AdminSubscriptions />} />
          <Route path="product-setup" element={<AdminProductSetup />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
