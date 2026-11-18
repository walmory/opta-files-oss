import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/ui';
import { BrandingProvider } from './config/BrandingProvider';
import EasyPDF from './pages/EasyPDF';
import AuthProvider from './features/auth/AuthProvider';

function App() {
  return (
    <BrandingProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <div className="h-screen w-full overflow-hidden">
              <Routes>
                <Route path="/" element={<EasyPDF />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </BrandingProvider>
  );
}

export default App;
