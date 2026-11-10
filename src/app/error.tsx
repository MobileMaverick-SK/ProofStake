'use client';

import { Icon } from './ui/symbol';

export default function ErrorScreen({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="main narrow">
      <div className="empty">
        <Icon name="error" className="large" />
        <h1 className="title-large">This screen could not load</h1>
        <p>Nothing happened to your money. Load the screen again.</p>
        <button type="button" className="button filled" onClick={reset}>
          <Icon name="refresh" />
          Load again
        </button>
      </div>
    </main>
  );
}
