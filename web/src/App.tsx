import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Link, usePath } from './router';
import { Library } from './views/Library';
import { Review } from './views/Review';
import { SettingsView } from './views/Settings';

export function App() {
  const path = usePath();
  const entryMatch = path.match(/^\/entry\/(\d+)/);
  const onReview = path.startsWith('/review');
  const onSettings = path.startsWith('/settings');
  const [due, setDue] = useState(0);

  const refreshDue = useCallback(() => {
    api.reviewStats().then((s) => setDue(s.due), () => {});
  }, []);

  useEffect(() => {
    refreshDue();
    const t = setInterval(refreshDue, 60_000);
    window.addEventListener('focus', refreshDue);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refreshDue);
    };
  }, [refreshDue, path]);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Word Record</Link>
        <nav className="tabs">
          <Link to="/" className={`tab ${!onReview && !onSettings ? 'on' : ''}`}>词库</Link>
          <Link to="/review" className={`tab ${onReview ? 'on' : ''}`}>
            复习{due > 0 && <span className="badge">{due}</span>}
          </Link>
          <Link to="/settings" className={`tab ${onSettings ? 'on' : ''}`}>设置</Link>
        </nav>
      </header>
      {onSettings ? (
        <SettingsView />
      ) : onReview ? (
        <Review onReviewed={refreshDue} />
      ) : (
        <Library selectedId={entryMatch ? Number(entryMatch[1]) : null} />
      )}
    </div>
  );
}
