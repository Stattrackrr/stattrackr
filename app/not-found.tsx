export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-xl mb-8">Page not found</p>
        <a href="/home" className="text-blue-500 hover:underline">
          Go to Home
        </a>
      </div>
    </div>
  );
}

