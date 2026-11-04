import { useState } from 'react';
import { Icon } from './Icon.js';

export function MediaPlayer({
  url,
  kind,
  title,
  compact = false,
}: {
  url: string;
  kind: 'video' | 'audio' | 'image' | string;
  title: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="media media--failed">
        <Icon name="alert" size={22} />
        <div>
          <strong>لا يمكن معاينة هذا الملف.</strong>
          <p className="muted small">
            قد يكون ملفًا تجريبيًا أو بصيغة لا يدعمها المشغّل. الملف موجود في مجلد المخرجات.
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noreferrer">
          فتح الملف
        </a>
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div className={`media ${compact ? 'media--compact' : ''}`}>
        <img src={url} alt={title} onError={() => setFailed(true)} />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="media media--audio">
        <audio controls src={url} onError={() => setFailed(true)} />
      </div>
    );
  }

  return (
    <div className={`media ${compact ? 'media--compact' : ''}`}>
      <video controls preload="metadata" src={url} onError={() => setFailed(true)} />
    </div>
  );
}
