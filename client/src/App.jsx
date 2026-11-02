import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setHealth(d.ok ? 'API + DB up' : `API down: ${d.error || ''}`))
      .catch((e) => setHealth(`API unreachable: ${e.message}`));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, background: '#F6F3EA', minHeight: '100vh' }}>
      <h1 style={{ color: '#1F2A22' }}>Alokdaar</h1>
      <p>Education aid, made transparent.</p>
      <p>
        Backend health: <strong>{health}</strong>
      </p>
    </main>
  );
}
