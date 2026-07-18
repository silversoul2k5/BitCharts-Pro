'use client';

import dynamic from 'next/dynamic';

const ChartForgeApp = dynamic(() => import('./ChartForgeApp'), {
  ssr: false,
  loading: () => (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b6480', fontFamily: 'sans-serif' }}>
      Loading ChartForge Live…
    </div>
  ),
});

export default function ChartForgeLoader() {
  return <ChartForgeApp />;
}
