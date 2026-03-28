import Link from 'next/link';

export default function ReadMePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white px-5 py-8">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <h1 className="text-2xl font-semibold">Add StatTrackr To Your Home Screen</h1>
        <p className="mt-3 text-slate-300">
          Pin Stattrackr to your phone home screen so it opens like an app.
        </p>

        <div className="mt-6 space-y-6 text-sm text-slate-200">
          <section>
            <h2 className="font-semibold text-white">iPhone (iOS - Safari)</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open Stattrackr in Safari.</li>
              <li>Tap the Share icon (square with arrow up).</li>
              <li>Scroll down and tap <span className="font-semibold">Add to Home Screen</span>.</li>
              <li>Rename it if you want, then tap <span className="font-semibold">Add</span>.</li>
              <li>Stattrackr will now appear on your home screen.</li>
            </ol>
          </section>

          <section>
            <h2 className="font-semibold text-white">Android (Chrome)</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open Stattrackr in Chrome.</li>
              <li>Tap the three-dot menu in the top-right.</li>
              <li>Tap <span className="font-semibold">Add to Home screen</span> (or <span className="font-semibold">Install app</span>).</li>
              <li>Confirm by tapping <span className="font-semibold">Add</span> or <span className="font-semibold">Install</span>.</li>
              <li>Stattrackr will be added to your home screen.</li>
            </ol>
          </section>

        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            Back To Stattrackr
          </Link>
        </div>
      </div>
    </main>
  );
}

