import { useState } from 'react';
import { api, type Entry } from '../api';

export function AddForm({ onAdded, onClose }: { onAdded: (e: Entry) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { entry } = await api.capture({ text, sentence });
      onAdded(entry);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="单词或短语" maxLength={200} />
      <textarea value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="所在句子（可选，用于解析语境含义）" rows={2} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? '解析中…' : '添加'}</button>
      </div>
    </form>
  );
}
