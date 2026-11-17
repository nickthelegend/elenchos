import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Studio } from './studio/Studio.tsx';
import { Landing } from './Landing.tsx';
import './tokens.css';
import './landing.css';
import './styles.css';
import './studio/studio.css';

// Two pages, hash-routed so the same static build works behind the agent server and on any static host:
// "#/app" is the studio, everything else is the landing page.
function Root() {
  const read = () => (window.location.hash.startsWith('#/app') ? 'app' : 'landing');
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => { const p = read(); setPage((old) => { if (old !== p) window.scrollTo(0, 0); return p; }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return page === 'app' ? <Studio /> : <Landing />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
