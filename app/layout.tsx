import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import GlobalSyncProgress from '@/components/layout/GlobalSyncProgress';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Meble → Allegro / Empik Panel',
  description: 'Zarządzaj meblami i wystawiaj oferty na Allegro i Empik',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <html lang="pl">
      <body className={inter.className}>
        <div className="flex h-screen overflow-hidden bg-gray-50">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto p-6">
              {children}
            </main>
          </div>
        </div>
        <GlobalSyncProgress />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { maxWidth: '420px' },
          }}
        />
      </body>
    </html>
  );
}
