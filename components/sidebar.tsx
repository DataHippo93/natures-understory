'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  userEmail?: string | null;
}

const sections = [
  {
    label: 'Overview',
    items: [
      {
        href: '/',
        label: 'Dashboard',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/shifts',
        label: 'Shift Analysis',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/schedule',
        label: 'Schedule',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/labor',
        label: 'Labor Ratio',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
          </svg>
        ),
      },
      {
        href: '/coolers',
        label: 'Coolers',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M10 1a3 3 0 0 0-3 3v6.1a4.5 4.5 0 1 0 6 0V4a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 0 1 3 0v6.9a.75.75 0 0 0 .3.6 3 3 0 1 1-3.6 0 .75.75 0 0 0 .3-.6V4Zm1.5 4.25a.75.75 0 0 1 .75.75v3.336a2 2 0 1 1-1.5 0V9a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/orders',
        label: "Albert's Orders",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M5.5 3A2.5 2.5 0 0 0 3 5.5v9A2.5 2.5 0 0 0 5.5 17h9a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 14.5 3h-9ZM6 6.75A.75.75 0 0 1 6.75 6h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 6.75Zm0 3.5a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Zm.75 2.75a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/orders/next-produce',
        label: 'Next Produce Order',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
            <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/vendors/produce',
        label: 'Produce Vendors',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M3 5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5Zm9 8.5a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Zm-.5-9a2 2 0 0 1 2-2H17a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2v-4Z" clipRule="evenodd" />
          </svg>
        ),
      },
      {
        href: '/inventory/stock-take',
        label: 'Stock Take',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25Zm9.03 5.78a.75.75 0 0 0-1.06-1.06l-3.97 3.97-1.47-1.47a.75.75 0 1 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z" clipRule="evenodd" />
          </svg>
        ),
      },
    ],
  },
];

const adminItems = [
  {
    href: '/admin/users',
    label: 'Users & Roles',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
      </svg>
    ),
  },
];

const reportItems = [
  {
    href: '/reports/categories',
    label: 'Category Sales',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM9.5 6A1.5 1.5 0 0 0 8 7.5v9a1.5 1.5 0 0 0 3 0v-9A1.5 1.5 0 0 0 9.5 6ZM3.5 10A1.5 1.5 0 0 0 2 11.5v5a1.5 1.5 0 0 0 3 0v-5A1.5 1.5 0 0 0 3.5 10Z" />
      </svg>
    ),
  },
  {
    href: '/reports/items',
    label: 'Item Sales',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path fillRule="evenodd" d="M4.5 2A2.5 2.5 0 0 0 2 4.5v3.879a2.5 2.5 0 0 0 .732 1.767l7.5 7.5a2.5 2.5 0 0 0 3.536 0l3.878-3.878a2.5 2.5 0 0 0 0-3.536l-7.5-7.5A2.5 2.5 0 0 0 8.38 2H4.5ZM5 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/reports/pricing',
    label: 'Produce Pricing',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M10.75 10.818v2.614A3.13 3.13 0 0 0 11.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 0 0-1.138-.432ZM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 0 0-.35.13c-.14.065-.27.143-.386.233-.377.292-.514.627-.514.909 0 .184.058.39.33.615Z" />
        <path fillRule="evenodd" d="M9.99 1.75C5.44 1.75 1.75 5.44 1.75 9.99 1.75 14.54 5.44 18.25 9.99 18.25c4.55 0 8.26-3.71 8.26-8.26 0-4.55-3.71-8.24-8.26-8.24Zm.74 5.5a.74.74 0 0 0-1.48 0v.42a3.67 3.67 0 0 0-1.52.81c-.56.49-.84 1.14-.84 1.83 0 .7.3 1.35.89 1.83.48.4 1.06.65 1.47.76v2.8a3.32 3.32 0 0 1-1.12-.55l-.75-.57a.75.75 0 0 0-.91 1.2l.75.56c.55.42 1.21.69 1.91.79v.38a.75.75 0 0 0 1.5 0v-.4a3.88 3.88 0 0 0 1.7-.79c.64-.53 1-1.27 1-2.12 0-.82-.33-1.55-1-2.09a4.08 4.08 0 0 0-1.7-.76V8.17c.27.06.52.17.74.33l.53.38a.75.75 0 0 0 .87-1.22l-.53-.37a3.68 3.68 0 0 0-1.61-.53v-.36Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/reports/cleanup',
    label: 'Inventory Cleanup',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/reports/query',
    label: 'Custom Query',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 0 1 .633 1.265l-4 12a1 1 0 1 1-1.898-.632l4-12a1 1 0 0 1 1.265-.633ZM5.707 6.293a1 1 0 0 1 0 1.414L3.414 10l2.293 2.293a1 1 0 1 1-1.414 1.414l-3-3a1 1 0 0 1 0-1.414l3-3a1 1 0 0 1 1.414 0Zm8.586 0a1 1 0 0 1 1.414 0l3 3a1 1 0 0 1 0 1.414l-3 3a1 1 0 1 1-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 0 1 0-1.414Z" clipRule="evenodd" />
      </svg>
    ),
  },
];

const comingSoon = [
  { label: 'Inventory', icon: '📦' },
  { label: 'Settings', icon: '⚙️' },
];

export function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever navigation happens
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar (hidden on desktop) */}
      <header
        className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between px-4 lg:hidden"
        style={{ background: 'var(--forest-darkest)', borderBottom: '1px solid var(--forest-mid)' }}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--gold)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-[#082a1b]">
              <path fillRule="evenodd" d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.176 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152-.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 0 1 1.925-3.546 3.75 3.75 0 0 1 3.255 3.718Z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
            Nature&apos;s Understory
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-md"
          style={{ color: 'var(--cream)', border: '1px solid var(--forest-mid)' }}
        >
          {open ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </header>

      {/* Backdrop for the mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-30 flex h-screen w-56 flex-col transition-transform duration-200 lg:translate-x-0 lg:z-20',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ background: 'var(--forest-darkest)', borderRight: '1px solid var(--forest-mid)' }}
      >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--forest-mid)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--gold)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#082a1b]">
              <path fillRule="evenodd" d="M12.963 2.286a.75.75 0 0 0-1.071-.136 9.742 9.742 0 0 0-3.539 6.176 7.547 7.547 0 0 1-1.705-1.715.75.75 0 0 0-1.152-.082A9 9 0 1 0 15.68 4.534a7.46 7.46 0 0 1-2.717-2.248ZM15.75 14.25a3.75 3.75 0 1 1-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 0 1 1.925-3.546 3.75 3.75 0 0 1 3.255 3.718Z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
              Nature&apos;s
            </p>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--gold)', fontFamily: 'var(--font-josefin)' }}>
              Understory
            </p>
          </div>
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Nature&apos;s Storehouse · Canton, NY
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.label}>
            <p
              className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
            >
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all',
                        isActive
                          ? 'border-l-2 pl-[9px]'
                          : 'border-l-2 border-transparent pl-[9px]'
                      )}
                      style={
                        isActive
                          ? {
                              borderColor: 'var(--gold)',
                              background: 'var(--forest-hover)',
                              color: 'var(--cream)',
                            }
                          : { color: 'var(--sage)' }
                      }
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          (e.currentTarget as HTMLElement).style.color = 'var(--cream)';
                          (e.currentTarget as HTMLElement).style.background = 'var(--forest-mid)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          (e.currentTarget as HTMLElement).style.color = 'var(--sage)';
                          (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }
                      }}
                    >
                      <span style={{ color: isActive ? 'var(--gold)' : undefined }}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Reports */}
        <div>
          <p
            className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
          >
            Reports
          </p>
          <ul className="space-y-0.5">
            {reportItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all border-l-2 pl-[9px] ${isActive ? '' : 'border-transparent'}`}
                    style={isActive ? { borderColor: 'var(--gold)', background: 'var(--forest-hover)', color: 'var(--cream)' } : { color: 'var(--sage)' }}
                    onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--cream)'; (e.currentTarget as HTMLElement).style.background = 'var(--forest-mid)'; } }}
                    onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--sage)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                  >
                    <span style={{ color: isActive ? 'var(--gold)' : undefined }}>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Admin */}
        <div>
          <p
            className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-josefin)' }}
          >
            Admin
          </p>
          <ul className="space-y-0.5">
            {adminItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-all border-l-2 pl-[9px] ${isActive ? '' : 'border-transparent'}`}
                    style={isActive ? { borderColor: 'var(--gold)', background: 'var(--forest-hover)', color: 'var(--cream)' } : { color: 'var(--sage)' }}
                    onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--cream)'; (e.currentTarget as HTMLElement).style.background = 'var(--forest-mid)'; } }}
                    onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--sage)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                  >
                    <span style={{ color: isActive ? 'var(--gold)' : undefined }}>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Coming soon */}
        <div>
          <p
            className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--forest-light)', fontFamily: 'var(--font-josefin)' }}
          >
            Coming Soon
          </p>
          <ul className="space-y-0.5">
            {comingSoon.map((item) => (
              <li key={item.label}>
                <span
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-md border-l-2 border-transparent px-2.5 py-2 pl-[9px] text-sm"
                  style={{ color: 'var(--forest-light)', opacity: 0.6 }}
                >
                  <span className="text-[13px]">{item.icon}</span>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* User / Sign out */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid var(--forest-mid)' }}>
        {userEmail && (
          <p className="mb-2 truncate text-[11px]" style={{ color: 'var(--sage)' }}>
            {userEmail}
          </p>
        )}
        <form action="/api/auth/sign-out" method="POST">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors"
            style={{ color: 'var(--sage)', border: '1px solid var(--forest-mid)' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--cream)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color = 'var(--sage)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--forest-mid)';
            }}
          >
            Sign Out
          </button>
        </form>
      </div>
    </aside>
    </>
  );
}
