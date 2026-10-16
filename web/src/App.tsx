import { Link, usePath } from './router';
import { Library } from './views/Library';

export function App() {
  const path = usePath();
  const entryMatch = path.match(/^\/entry\/(\d+)/);

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">Word Record</Link>
        <nav className="tabs">
          <Link to="/" className={`tab ${!path.startsWith('/review') ? 'on' : ''}`}>词库</Link>
        </nav>
      </header>
      <Library selectedId={entryMatch ? Number(entryMatch[1]) : null} />
    </div>
  );
}
