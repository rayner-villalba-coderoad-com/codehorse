import type { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import AppSidebar from '@/components/app-sidebar';
import { Separator  } from '@/components/ui/separator';
import { requireAuth } from '@/module/auth/utils/auth-utils';

// export const metadata = {
//   title: 'Dashboard',
// };

export default async function DashboardLayout({ children }: { children: ReactNode  }) {
  await requireAuth();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className='flex h-16 shrink-0 items-center gap-2 border-b px-4'>
          <SidebarTrigger className='-m1-1' />
          <Separator orientation='vertical' className='mx-2 h-4' />
          <h1 className='text-xl font-semibold text-foreground'>CodeRoad AI Reviewer</h1>
        </header>
        <main className='flex-1 overflow-auto p-4 md:p-6'>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}