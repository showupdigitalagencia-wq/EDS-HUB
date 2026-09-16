import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: ReactNode;
  title: string;
}

export function Layout({ children, title }: LayoutProps) {
  return (
    <div className="min-h-screen flex bg-surface-50">
      <Sidebar />
      <main className="flex-1 ml-64">
        <div className="p-8">
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
