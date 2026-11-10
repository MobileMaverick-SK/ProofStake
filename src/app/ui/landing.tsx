import Link from 'next/link';
import { PublicFrame } from './public-frame';
import { Icon } from './symbol';

/** What a signed-out visitor sees: what the product does, shown with its own screens. */
export function Landing() {
  return (
    <PublicFrame
      action={
        <Link href="/login" className="button text">
          Sign in
        </Link>
      }
    >
      <main>
        <section className="landing-hero">
          <div className="stack loose">
            <h1 className="display">Put money on your own deadline.</h1>
            <p className="body-large muted lede">
              Set a goal and a stake. PayPal holds the money. Prove you finished with a photo and you pay nothing.
              Miss it and the stake goes to charity.
            </p>
            <div className="row wrap">
              <Link href="/signup" className="button filled large">
                Create your account
              </Link>
              <Link href="/login" className="button outlined large">
                Sign in
              </Link>
            </div>
            <p className="body-small muted row tight">
              <Icon name="science" className="small" />
              PayPal sandbox demo. No real money moves.
            </p>
          </div>

          <div className="preview" aria-hidden="true">
            <div className="hero tertiary stack">
              <span className="chip on-container" style={{ alignSelf: 'flex-start' }}>
                <Icon name="timer" className="small" />
                In progress
              </span>
              <p className="title-large">Finish chapter 3 notes, all 12 pages</p>
              <p className="timer">21:14:09</p>
              <p className="label">$20.00 on hold</p>
            </div>
            <div className="card row" style={{ background: 'var(--surface-container-high)' }}>
              <span className="badge big">
                <Icon name="photo_camera" />
              </span>
              <span className="grow stack" style={{ gap: 2 }}>
                <span className="title">Photo proof, with code K7M4QX</span>
                <span className="body-small muted">3 of 3 checks passed, 96% confident</span>
              </span>
            </div>
            <div className="card primary row">
              <span className="badge big good">
                <Icon name="check_circle" className="filled" />
              </span>
              <span className="grow stack" style={{ gap: 2 }}>
                <span className="title">Goal met. You kept your $20.00</span>
                <span className="body-small">Hold released, nothing charged</span>
              </span>
            </div>
          </div>
        </section>

        <section className="stack loose" aria-labelledby="how-heading">
          <h2 id="how-heading" className="headline">
            How it works
          </h2>
          <ol className="how">
            <li>
              <h3 className="title">Set a goal, a deadline and a stake</h3>
              <p className="body-small muted">Up to 3 days out, $1 to $500. Proof rules are written for you to accept.</p>
            </li>
            <li>
              <h3 className="title">PayPal holds the stake</h3>
              <p className="body-small muted">A hold, not a charge. The money stays yours while you work.</p>
            </li>
            <li>
              <h3 className="title">Upload a photo of the finished work</h3>
              <p className="body-small muted">It must include a one-time code, so an old photo will not pass.</p>
            </li>
            <li>
              <h3 className="title">The money settles</h3>
              <p className="body-small muted">Met: released in full. Partly met: charged in proportion. Missed: charged.</p>
            </li>
          </ol>
        </section>

        <section style={{ padding: '56px 0 0' }} aria-label="What you can rely on">
          <ul className="assurances">
            <li>
              <span className="badge">
                <Icon name="gavel" />
              </span>
              <div className="stack" style={{ gap: 4 }}>
                <h3 className="title">The AI gives a verdict. Code moves the money.</h3>
                <p className="body-small muted">Amounts are computed by fixed rules on the server, never by the model.</p>
              </div>
            </li>
            <li>
              <span className="badge">
                <Icon name="manage_search" />
              </span>
              <div className="stack" style={{ gap: 4 }}>
                <h3 className="title">Unsure verdicts go to a person</h3>
                <p className="body-small muted">Below 80% confidence nothing is charged until a reviewer decides.</p>
              </div>
            </li>
            <li>
              <span className="badge">
                <Icon name="volunteer_activism" />
              </span>
              <div className="stack" style={{ gap: 4 }}>
                <h3 className="title">Missed stakes go to charity</h3>
                <p className="body-small muted">Never to other users, so nobody profits from you failing.</p>
              </div>
            </li>
          </ul>
        </section>
      </main>
    </PublicFrame>
  );
}
