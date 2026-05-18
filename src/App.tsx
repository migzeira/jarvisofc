import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { SupabaseProvider } from "@/contexts/SupabaseContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequireActivePlan } from "@/components/RequireActivePlan";
import { lazy, Suspense } from "react";
import logoIcon from "@/assets/logo_icon.webp";

// Tudo carrega sob demanda (lazy loading)
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const EmailConfirmed = lazy(() => import("./pages/EmailConfirmed"));
const Obrigado = lazy(() => import("./pages/Obrigado"));
const BemVindo = lazy(() => import("./pages/BemVindo"));
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
const AdminViewAs = lazy(() => import("./pages/admin/AdminViewAs"));

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
        {/*
         * SupabaseProvider envolve a árvore inteira fornecendo o cliente Supabase
         * via Context. Em rotas normais usa o cliente default (admin/user). Em
         * rotas /admin/view-as/* (Fase 3) será envelopado por um Provider que
         * passa o impersonationClient — assim páginas migradas pra useSupabase()
         * automaticamente fazem queries como se fossem o user-alvo.
         *
         * Fase 1: inerte. Components continuam usando import direto. Sem efeito.
         */}
        <SupabaseProvider>
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
              <Route path="/email-confirmado" element={<EmailConfirmed />} />
              <Route path="/auth/callback" element={<EmailConfirmed />} />
              <Route path="/obrigado" element={<Obrigado />} />
              <Route path="/bem-vindo" element={<BemVindo />} />
              <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
                {/* Home (Início) e Configurações ficam sempre acessíveis — user precisa
                    poder entrar pra ver status do plano e renovar. */}
                <Route index element={<DashboardHome />} />
                <Route path="configuracoes" element={<Configuracoes />} />

                {/* Páginas restritas — bloqueadas se trial expirou ou conta pending/suspended.
                    Quem está em trial ativo OU plano ativo continua acessando normal. */}
                <Route path="financas" element={<RequireActivePlan><Financas /></RequireActivePlan>} />
                <Route path="agenda" element={<RequireActivePlan><Agenda /></RequireActivePlan>} />
                <Route path="anotacoes" element={<RequireActivePlan><Anotacoes /></RequireActivePlan>} />
                <Route path="lembretes" element={<RequireActivePlan><Lembretes /></RequireActivePlan>} />
                <Route path="habitos" element={<RequireActivePlan><Habitos /></RequireActivePlan>} />
                <Route path="contatos" element={<RequireActivePlan><Contatos /></RequireActivePlan>} />
                <Route path="analytics" element={<RequireActivePlan><Analytics /></RequireActivePlan>} />
                <Route path="integracoes" element={<RequireActivePlan><Integracoes /></RequireActivePlan>} />

                {/* Old routes redirect to the unified Configurações page with the right tab pre-selected — keeps existing links working */}
                <Route path="agente" element={<Navigate to="/dashboard/configuracoes?tab=agente" replace />} />
                <Route path="perfil" element={<Navigate to="/dashboard/configuracoes?tab=perfil" replace />} />
              </Route>
              <Route path="/admin" element={<ProtectedRoute><AdminPanel /></ProtectedRoute>} />
              {/* Admin view-as: renderiza o dashboard inteiro do user-alvo dentro
                  de um SupabaseProvider secundário (impersonationClient).
                  Admin mantém sua própria sessão — não é logout.

                  Rotas filhas espelham a estrutura de /dashboard mas SEM
                  RequireActivePlan — admin precisa ver tudo, inclusive contas
                  com plano expirado/suspenso (exato caso de uso). */}
              <Route path="/admin/view-as/:userId" element={<ProtectedRoute><AdminViewAs /></ProtectedRoute>}>
                <Route index element={<DashboardHome />} />
                <Route path="configuracoes" element={<Configuracoes />} />
                <Route path="financas" element={<Financas />} />
                <Route path="agenda" element={<Agenda />} />
                <Route path="anotacoes" element={<Anotacoes />} />
                <Route path="lembretes" element={<Lembretes />} />
                <Route path="habitos" element={<Habitos />} />
                <Route path="contatos" element={<Contatos />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="integracoes" element={<Integracoes />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
        </SupabaseProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
