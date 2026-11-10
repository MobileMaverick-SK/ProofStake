'use client';

import { Children, useRef, useState, type ReactNode } from 'react';
import { Icon } from './symbol';

/**
 * One card at a time, moved by swiping, by the arrow buttons or by the arrow
 * keys. The scrolling itself is native (CSS scroll snap), so it feels right on
 * touch screens and still works without JavaScript.
 */
export function Carousel({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const slides = Children.toArray(children);
  const count = slides.length;

  function step(): number {
    const first = track.current?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + 16 : 1;
  }
  function go(to: number) {
    const target = Math.max(0, Math.min(count - 1, to));
    track.current?.scrollTo({ left: target * step(), behavior: 'smooth' });
  }

  return (
    <section className="carousel" aria-roledescription="carousel" aria-label={label}>
      <div
        className="carousel-track"
        ref={track}
        tabIndex={count > 1 ? 0 : undefined}
        onScroll={(event) => setIndex(Math.round(event.currentTarget.scrollLeft / step()))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') go(index + 1);
          if (event.key === 'ArrowLeft') go(index - 1);
        }}
      >
        {slides.map((slide, position) => (
          <div
            className="carousel-slide"
            key={position}
            role="group"
            aria-roledescription="slide"
            aria-label={`${position + 1} of ${count}`}
          >
            {slide}
          </div>
        ))}
      </div>
      {count > 1 ? (
        <div className="carousel-controls">
          <button type="button" className="icon-button plain" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous goal">
            <Icon name="chevron_left" />
          </button>
          <div className="carousel-dots" aria-hidden="true">
            {slides.map((_, position) => (
              <span key={position} className={position === index ? 'on' : undefined} />
            ))}
          </div>
          <span className="label numeric" aria-live="polite">
            {index + 1} of {count}
          </span>
          <button
            type="button"
            className="icon-button plain"
            onClick={() => go(index + 1)}
            disabled={index === count - 1}
            aria-label="Next goal"
          >
            <Icon name="chevron_right" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
