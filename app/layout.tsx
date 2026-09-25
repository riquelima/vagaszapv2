import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VagasZap • Remote Jobs Worldwide | Candidatura Automática com IA',
  description: 'Conecte-se às melhores vagas remotas internacionais em dólar e euro (Tech, Automação, IA e Operações) com candidatura 100% automatizada e preenchimento por inteligência artificial.',
  keywords: ['vagas remotas', 'trabalho em dolar', 'carreira internacional', 'inteligencia artificial', 'vagaszap', 'candidatura automatica'],
  openGraph: {
    title: 'VagasZap • Remote Jobs Worldwide',
    description: 'Encontre oportunidades globais e candidate-se com 1 clique usando Inteligência Artificial.',
    images: [{ url: '/logo.jpg', width: 800, height: 800, alt: 'VagasZap Logo' }],
  },
};

// Viewport metadata dedicada (Next.js 15 separa do metadata principal)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#043873',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="/logo.jpg" type="image/jpeg" />
        {/* iOS PWA / full-screen helpers */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>{children}</body>
    </html>
  );
}
