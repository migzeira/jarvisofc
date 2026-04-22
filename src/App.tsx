import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { lazy, Suspense } from "react";
import logoIcon from "@/assets/logo_icon.webp";

// Tudo carrega sob demanda (lazy loading)
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const TermosDeUso = lazy(() => import("./pages/TermosDeUso"));
const PoliticaPrivacidade = lazy(() => import("./pages/PoliticaPrivacidade"));
const NotFound = lazy(() => import("./pages/NotFound"));

const DashboardLayout = lazy(() => import("./components/DashboardLayout"));
const DashboardHome = lazy(() => import("./pages/dashboard/DashboardHome"));
const Financas = lazy(() => import("./pages/dashboard/Financas"));
const Agenda = lazy(() => import("./pages/dashboard/Agenda"));
const Anotacoes = lazy(() => import("./pages/dashboard/Anotacoes"));
const Lembretes = lazy(() => import("./pages/dashboard/Lembretes"));
const Habitos = lazy(() => import("./pages/dashboard/Habitos"));
const Integracoes = lazy(() => import("./pages/dashboard/Integracoes"));
const Configuracoes = lazy(() => import("./pages/dashboard/Configuracoes"));
const Analytics = lazy(() => import("./pages/dashboard/Analytics"));
const Contatos = lazy(() => import("./pages/dashboard/Contatos"));
const AdminPanel = lazy(() => import("./pages/admin/AdminPanel"));

// Loading com logo do Jarvis girando
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <img
        src={logoIcon}
        alt="Carregando..."
        className="w-12 h-12 animate-spin"
        style={{ animationDuration: "1.2s" }}
      />
    </div>
  );
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/termos-de-uso" element={<TermosDeUso />} />
              <Route path="/politica-de-privacidade" element={<PoliticaPrivacidade />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
                <Route index element={<DashboardHome />} />
                <Route path="financas" element={<Financas />} />
                <Route path="agenda" element={<Agenda />} />
                <Route path="anotacoes" element={<Anotacoes />} />
                <Route path="lembretes" element={<Lembretes />} />
                <Route path="habitos" element={<Habitos />} />
                <Route path="integracoes" element={<Integracoes />} />
                <Route path="configuracoes" element={<Configuracoes />} />
                {/* Old routes redirect to the unified Configurações page with the right tab pre-selected — keeps existing links working */}
                <Route path="agente" element={<Navigate to="/dashboard/configuracoes?tab=agente" replace />} />
                <Route path="perfil" element={<Navigate to="/dashboard/configuracoes?tab=perfil" replace />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="contatos" element={<Contatos />} />
              </Route>
              <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
