'use client';

import { ChevronLeft, ChevronRight, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ReadMePage = {
  title: string;
  paragraphs: string[];
  points?: string[];
  sections?: Array<{ heading: string; steps: string[] }>;
  footnote?: string;
};

const PAGES: ReadMePage[] = [
  {
    title: 'This is not a get rich quick scheme',
    paragraphs: [
      'Stattrackr AI is built to win over time, not every day.',
      'There will be losing days and losing weeks. There will also be winning days and winning weeks. Judge the model on hundreds of picks, not on one bad night.',
    ],
  },
  {
    title: 'How the model chooses picks',
    paragraphs: [
      'Every few minutes the board is scanned across NBA, NBL and tennis. Statistical models project each market — player props, game lines, match markets — from form, matchups, pace, minutes, injuries and rest, then compare that to the best bookmaker price we can find.',
      'A play only makes the shortlist when our probability beats the market by enough, at least two books price it, and recent hit rates support the side. Soft one-book prices and thin samples are skipped. Candidates are watched as prices move; NBA plays that hang on a questionable call wait until closer to tip.',
      'From that list, only the strongest edges are taken — singles and the occasional multi — with caps so one game or one player is not overbet. A second pass then reads the same evidence like a careful punter and rejects anything it would not back.',
      'What gets through is posted at the best available line, with a unit size from the edge and the model\'s own track record. Settled results feed back into the knobs over time so the bar can tighten when things are soft.',
    ],
  },
  {
    title: 'Take the line as early as you can',
    paragraphs: [
      'Bet every pick as close to when it is posted as possible.',
      'The model is built to beat the line before tip-off. As the game gets closer the market moves towards the model, so the price posted is usually the best one you will get. The longer you wait, the less value is left.',
    ],
  },
  {
    title: 'Turn on pick alerts',
    paragraphs: ['The easiest way to get on early is a notification the moment a pick is posted.'],
    sections: [
      {
        heading: 'iPhone and iPad',
        steps: [
          'Open StatTrackr in Safari.',
          'Tap the Share button, then Add to Home Screen.',
          'Open StatTrackr from the new icon on your home screen and sign in.',
          'Go to Picks, tap Turn on pick alerts, then tap Allow.',
        ],
      },
      {
        heading: 'Android',
        steps: ['Open the Picks page in Chrome.', 'Tap Turn on pick alerts, then tap Allow.'],
      },
      {
        heading: 'PC and Mac',
        steps: [
          'Open the Picks page in Chrome, Edge, Firefox or Safari.',
          'Click Turn on pick alerts, then click Allow.',
          'Alerts come through while your browser is open.',
        ],
      },
    ],
    footnote:
      'Once alerts are on, tap Alerts on, then Send test alert to check it works. If the button says Alerts blocked, allow notifications for StatTrackr in your phone or browser settings (on a computer, click the icon next to the address bar). iPhone needs iOS 16.4 or later.',
  },
  {
    title: 'You need more than one bookmaker',
    paragraphs: [
      'Every pick is posted at the best line the model can find for that market, so it helps to have accounts with several bookmakers.',
      'The ones that come up most often:',
    ],
    points: ['Dabble', 'PointsBet', 'Unibet', 'Ladbrokes'],
  },
  {
    title: 'How units work',
    paragraphs: [
      'Every pick is tracked in units. You set what a unit is worth based on your own bankroll.',
      'Your bankroll is the money you have set aside to bet with. We recommend 1-2% of your bankroll per unit.',
    ],
    points: ['Bankroll of $1,000', '1 unit = $10 to $20', 'A 1.5 unit pick = $15 to $30'],
  },
  {
    title: 'Bet responsibly',
    paragraphs: [
      'Picks are generated automatically from statistical models and are provided for information and entertainment only. They are not financial or betting advice, and past results do not guarantee future results.',
      'You must be 18+ to bet. Only bet what you can afford to lose, and never chase losses.',
      'If gambling is causing you harm, call Gambling Help Online on 1800 858 858 or visit gamblinghelponline.org.au.',
    ],
  },
];

export function PicksReadMeButton() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const page = PAGES[index]!;
  const last = index === PAGES.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, PAGES.length - 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <Info className="h-3.5 w-3.5" />
        Read me
      </button>
      {open
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[180] bg-black/70" onClick={() => setOpen(false)} aria-hidden />
              <div className="fixed inset-0 z-[190] flex items-center justify-center p-3 sm:p-6" onClick={() => setOpen(false)}>
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="picks-read-me-title"
                  className="flex max-h-[min(85dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-[#0f1a2b]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-300">
                        Read me · {index + 1} of {PAGES.length}
                      </p>
                      <h2 id="picks-read-me-title" className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-white">
                        {page.title}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="chat-scrollbar min-h-[200px] space-y-3 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300 sm:px-5">
                    {page.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                    {page.points ? (
                      <ul className="space-y-1.5">
                        {page.points.map((point) => (
                          <li key={point} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {page.sections?.map((section) => (
                      <div key={section.heading} className="rounded-xl border border-gray-200 px-3 py-2.5 dark:border-gray-700">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{section.heading}</h3>
                        <ol className="mt-1.5 space-y-1">
                          {section.steps.map((step, i) => (
                            <li key={step} className="flex gap-2">
                              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/15 text-[11px] font-bold text-purple-700 dark:text-purple-200">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                    {page.footnote ? <p className="text-xs text-gray-500 dark:text-gray-400">{page.footnote}</p> : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5">
                    <button
                      type="button"
                      onClick={() => setIndex((i) => i - 1)}
                      disabled={index === 0}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:invisible dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back
                    </button>
                    <div className="flex items-center gap-1.5">
                      {PAGES.map((p, i) => (
                        <button
                          key={p.title}
                          type="button"
                          onClick={() => setIndex(i)}
                          aria-label={`Page ${i + 1}: ${p.title}`}
                          className={`h-1.5 rounded-full transition-all ${
                            i === index ? 'w-4 bg-purple-600' : 'w-1.5 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600'
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => (last ? setOpen(false) : setIndex((i) => i + 1))}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
                    >
                      {last ? 'Got it' : 'Next'}
                      {last ? null : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
