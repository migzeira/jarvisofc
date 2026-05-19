import { Home, Wallet, CalendarDays, StickyNote, Settings, LogOut, Shield, Bell, X, Zap, BookUser, BookOpen, Sparkles, Bug, HelpCircle, ChevronDown, MessageCircle } from "lucide-react";
import { JARVIS_WHATSAPP_LINK } from "@/lib/jarvis";
import { NavLink } from "@/components/NavLink";
import logoEscrita from "@/assets/logo_escrita.webp";
import logoIcon from "@/assets/logo_icon.webp";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState } from "react";
import { OnboardingModal } from "@/components/OnboardingModal";
import { TriggerPhrasesModal } from "@/components/TriggerPhrasesModal";
import { BugReportModal } from "@/components/BugReportModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

// Itens do menu — os paths são RELATIVOS (sem prefixo). Sidebar prefixa
// dinamicamente com /dashboard OU /admin/view-as/<userId> dependendo do contexto.
const menuItems = [
  { title: "Início",         path: "",              icon: Home },
  { title: "Finanças",       path: "/financas",     icon: Wallet },
  { title: "Agenda",         path: "/agenda",       icon: CalendarDays },
  { title: "Lembretes",      path: "/lembretes",    icon: Bell },
  { title: "Anotações",      path: "/anotacoes",    icon: StickyNote },
  { title: "Hábitos",        path: "/habitos",      icon: Zap },
  { title: "Contatos",       path: "/contatos",     icon: BookUser },
  { title: "Google Calendar",path: "/integracoes",  icon: CalendarDays },
  { title: "Configurações",  path: "/configuracoes",icon: Settings },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // Detecta modo view-as via pathname (em vez de useParams pra não acoplar
  // com a estrutura de rotas e funcionar em qualquer ponto da árvore).
  // /admin/view-as/<userId>/<rest> → split[3] = userId
  const isViewAs = location.pathname.startsWith("/admin/view-as/");
  const viewAsUserId = isViewAs ? location.pathname.split("/")[3] : null;
  const baseUrl = isViewAs && viewAsUserId
    ? `/admin/view-as/${viewAsUserId}`
    : "/dashboard";

  const handleLogout = async () => {
    if (isMobile) setOpenMobile(false);
    await signOut();
    navigate("/");
  };

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handleAdminClick = () => {
    if (isMobile) setOpenMobile(false);
    navigate("/admin");
  };

  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [triggerPhrasesOpen, setTriggerPhrasesOpen] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);

  // Helper: fecha o dropdown e a sidebar mobile antes de abrir o modal
  const openModalFromMenu = (open: () => void) => {
    setHelpMenuOpen(false);
    if (isMobile) setOpenMobile(false);
    // pequeno delay pra animação do dropdown não conflitar com a do dialog
    setTimeout(open, 50);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-4 h-16 border-b border-border">
        <img src={collapsed ? logoIcon : logoEscrita} alt="Hey Jarvis" className={`object-contain ${collapsed ? "h-8 w-8" : "h-8 w-auto"}`} />
        {isMobile && (
          <Button variant="ghost" size="icon" aria-label="Fechar menu" className="h-8 w-8" onClick={() => setOpenMobile(false)}>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const fullUrl = `${baseUrl}${item.path}`;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={fullUrl}
                        end={item.path === ""}
                        className="hover:bg-accent/50 transition-colors"
                        activeClassName="bg-accent text-primary font-medium"
                        onClick={handleNavClick}
                      >
                        <item.icon className="h-4 w-4 mr-2 flex-shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {/* ── Botão "Falar com o Jarvis" ─────────────────────────────
                 Feedback Gabriela (19/05): usuária leiga ficou perdida sem
                 saber onde achar o número do Jarvis pra mandar a 1ª msg.
                 Botão verde destacado abaixo de Configurações abre wa.me
                 direto com "Oi Jarvis!" pré-preenchido.

                 Visível também em view-as: admin pode querer abrir o WhatsApp
                 do Jarvis (vai pelo número do PRÓPRIO admin, não do user-alvo
                 — é só um link wa.me externo, inofensivo). Útil pra testar
                 que o Jarvis tá respondendo quando ajudando cliente.
               */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a
                    href={JARVIS_WHATSAPP_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleNavClick}
                    className="
                      bg-gradient-to-r from-green-500/15 to-emerald-500/15
                      hover:from-green-500/25 hover:to-emerald-500/25
                      border border-green-500/30 hover:border-green-500/50
                      text-green-300 hover:text-green-200
                      transition-all
                      mt-2
                    "
                  >
                    <MessageCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                    {!collapsed && <span className="font-medium">Falar com o Jarvis</span>}
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-border space-y-1">
        {/*
         * Em modo view-as, esconde:
         *  - Botão "Painel Admin" (já tem o banner sticky pra sair)
         *  - Dropdown "Ajuda & Conta" (cujas ações como "Sair" deslogariam a
         *    sessão de impersonation, comportamento confuso pro admin)
         *
         * Em vez disso, mostra um aviso/atalho visual leve indicando que
         * está em modo view-as. O sair acontece pelo banner do AdminViewAs.
         */}
        {isAdmin && !isViewAs && (
          <Button variant="ghost" className="w-full justify-start text-purple-400 hover:text-purple-300 hover:bg-purple-500/10" onClick={handleAdminClick}>
            <Shield className="h-4 w-4 mr-2 flex-shrink-0" />
            {!collapsed && <span>Painel Admin</span>}
          </Button>
        )}
        {isViewAs && (
          <Button
            variant="ghost"
            className="w-full justify-start text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              navigate("/admin");
            }}
          >
            <Shield className="h-4 w-4 mr-2 flex-shrink-0" />
            {!collapsed && <span>Voltar ao Admin</span>}
          </Button>
        )}
        {/* Botão único "Ajuda & Conta" — agrupa: Como usar, Frases, Reportar bug, Sair.
            Esconde em modo view-as: "Sair" deslogaria a sessão de impersonation
            (inútil/confuso) e os outros itens são pra UX do user final, não admin. */}
        {!isViewAs && (
        <DropdownMenu open={helpMenuOpen} onOpenChange={setHelpMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
            >
              <HelpCircle className="h-4 w-4 mr-2 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">Ajuda & Conta</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="top"
            className="w-56"
          >
            <DropdownMenuItem onSelect={() => openModalFromMenu(() => setOnboardingOpen(true))}>
              <BookOpen className="h-4 w-4 mr-2 text-violet-400" />
              Como usar o Jarvis
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openModalFromMenu(() => setTriggerPhrasesOpen(true))}>
              <Sparkles className="h-4 w-4 mr-2 text-violet-400" />
              Frases das Ações
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openModalFromMenu(() => setBugReportOpen(true))}>
              <Bug className="h-4 w-4 mr-2 text-rose-400" />
              Reportar bug
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setHelpMenuOpen(false);
                handleLogout();
              }}
              className="text-muted-foreground focus:text-foreground"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </SidebarFooter>

      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      <TriggerPhrasesModal open={triggerPhrasesOpen} onClose={() => setTriggerPhrasesOpen(false)} />
      <BugReportModal open={bugReportOpen} onOpenChange={setBugReportOpen} />
    </Sidebar>
  );
}
