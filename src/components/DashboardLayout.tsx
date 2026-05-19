import { Outlet } from "react-router-dom";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { TrialBanner } from "@/components/TrialBanner";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CoupleContextProvider } from "@/hooks/useCoupleContext";
import { useIsViewAs } from "@/hooks/useDashboardBasePath";

function DashboardHeader() {
  const { toggleSidebar, openMobile } = useSidebar();
  const isMobile = useIsMobile();
  const isViewAs = useIsViewAs();

  // Em modo view-as, o ViewAsBanner (h-12 = 48px) fica sticky top-0 z-60.
  // Sem ajuste, o DashboardHeader (sticky top-0 z-30) ficaria atrás da banner
  // visualmente sobreposto. Fix: empurra o header pra top-12 (48px) em view-as,
  // pra ficar exatamente abaixo da banner sem sobreposição.
  const stickyTop = isViewAs ? "top-12" : "top-0";

  return (
    <header className={`h-14 flex items-center justify-between border-b border-border px-4 bg-background/80 backdrop-blur-sm sticky ${stickyTop} z-30`}>
      {isMobile ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={openMobile ? "Fechar menu" : "Abrir menu"}
          className="gap-2 h-8 px-2"
          onClick={toggleSidebar}
        >
          {openMobile ? (
            <X className="h-5 w-5" />
          ) : (
            <>
              <Menu className="h-5 w-5" />
              <span className="text-sm font-medium">Menu</span>
            </>
          )}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Alternar menu lateral"
          className="h-7 w-7"
          onClick={toggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <div id="dashboard-header-actions" />
    </header>
  );
}

export default function DashboardLayout() {
  return (
    <CoupleContextProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <DashboardHeader />
            <AnnouncementBanner />
            <TrialBanner />
            <OnboardingBanner />
            <main className="flex-1 p-4 md:p-6 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </CoupleContextProvider>
  );
}
