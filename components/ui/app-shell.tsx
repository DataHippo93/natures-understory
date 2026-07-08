import { Sidebar } from '@/components/sidebar';

interface AppShellProps {
  userEmail?: string | null;
  userRole?: string | null;
  children: React.ReactNode;
}

/**
 * Layout shell wrapping every authenticated route. Handles the sidebar,
 * mobile top-bar offset, safe-area padding for the iOS notch and home
 * indicator, and a responsive main container. Every page renders its
 * content inside; layout concerns (offsets, safe area, chrome) live here.
 */
export function AppShell({ userEmail, userRole, children }: AppShellProps) {
  return (
    <>
      <Sidebar userEmail={userEmail} userRole={userRole} />
      <div
        className="lg:ml-56 min-h-screen flex flex-col pt-14 lg:pt-0"
        style={{
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <main className="flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <footer
          className="px-4 py-3 text-xs lg:px-8"
          style={{
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--forest-mid)',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
        >
          Nature&apos;s Storehouse · Canton, NY · Internal use only
        </footer>
      </div>
    </>
  );
}
