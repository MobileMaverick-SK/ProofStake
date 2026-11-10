import Link from 'next/link';
import { Icon } from './ui/symbol';

export default function NotFound() {
  return (
    <main className="main narrow">
      <div className="empty">
        <Icon name="search_off" className="large" />
        <h1 className="title-large">That page does not exist</h1>
        <p>The goal may belong to another account, or the link is incomplete.</p>
        <Link href="/" className="button filled">
          <Icon name="home" />
          Go to your goals
        </Link>
      </div>
    </main>
  );
}
