import { Home, Wallet, CalendarDays, StickyNote, MessageSquare, Link2, Settings, User, LogOut, Menu, Shield, Bell } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import logoEscrita from "@/assets/logo_escrita.png";
import logoIcon from "@/assets/logo_icon.png";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
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

const menuItems = [
  { title: "Início", url: "/dashboard", icon: Home },
  { title: "Finanças", url: "/dashboard/financas", icon: Wallet },
  { title: "Agenda", url: "/dashboard/agenda", icon: CalendarDays },
  { title: "Anotações", url: "/dashboard/anotacoes", icon: StickyNote },
  { title: "Conversas", url: "/dashboard/conversas", icon: MessageSquare },
  { title: "Lembretes", url: "/dashboard/lembretes", icon: Bell },
  { title: "Integrações", url: "/dashboard/integracoes", icon: Link2 },
  { title: "Config. do Agente", url: "/dashboard/agente", icon: Settings },
  
  { title: "Meu Perfil", url: "/dashboard/perfil", icon: User },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 px-4 h-16 border-b border-border">
        <img src={collapsed ? logoIcon : logoEscrita} alt="Minha Maya" className={`object-contain ${collapsed ? "h-8 w-8" : "h-7 w-auto"}`} />
      </div>
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-accent/50 transition-colors"
                      activeClassName="bg-accent text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 mr-2 flex-shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-border space-y-1">
        {isAdmin && (
          <Button variant="ghost" className="w-full justify-start text-purple-400 hover:text-purple-300 hover:bg-purple-500/10" onClick={() => navigate("/admin")}>
            <Shield className="h-4 w-4 mr-2 flex-shrink-0" />
            {!collapsed && <span>Painel Admin</span>}
          </Button>
        )}
        <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2 flex-shrink-0" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
