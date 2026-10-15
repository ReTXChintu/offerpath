import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export function App() {
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    invoke<string>('app_version')
      .then(setVersion)
      .catch(() => setVersion(undefined));
  }, []);

  return (
    <main
      style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem 1rem', textAlign: 'center' }}
    >
      <h1>Offerpath</h1>
      <p>Your desktop runs your AI and your job hunt. Keep it on.</p>
      {version && <p style={{ opacity: 0.6 }}>Version {version}</p>}
    </main>
  );
}
