import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { LocalInferenceProvider } from '@/components/LocalInferenceProvider';
import { SiteHeader } from '@/components/SiteHeader';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MeshCompute', template: '%s · MeshCompute' },
  description: 'Peer-to-peer AI compute marketplace powered by QVAC.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <LocalInferenceProvider>
            <SiteHeader />
            <main>{children}</main>
          </LocalInferenceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
