import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import DashboardLayout from "./components/DashboardLayout";
import DashboardHome from "./pages/dashboard/DashboardHome";
import Financas from "./pages/dashboard/Financas";
import Agenda from "./pages/dashboard/Agenda";
import Anotacoes from "./pages/dashboard/Anotacoes";
import Conversas from "./pages/dashboard/Conversas";
import Integracoes from "./pages/dashboard/Integracoes";
import ConfigAgente from "./pages/dashboard/ConfigAgente";
import MeuPlano from "./pages/dashboard/MeuPlano";
import MeuPerfil from "./pages/dashboard/MeuPerfil";
import AdminPanel from "./pages/admin/AdminPanel";
import NotFound from "./pages/NotFound";
import TermosDeUso from "./pages/TermosDeUso";
import PoliticaPrivacidade from "./pages/PoliticaPrivacidade";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
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
              <Route path="conversas" element={<Conversas />} />
              <Route path="integracoes" element={<Integracoes />} />
              <Route path="agente" element={<ConfigAgente />} />
              <Route path="plano" element={<MeuPlano />} />
              <Route path="perfil" element={<MeuPerfil />} />
            </Route>
            <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
