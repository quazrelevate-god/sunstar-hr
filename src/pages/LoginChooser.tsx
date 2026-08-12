import { Link } from "react-router-dom";

export default function LoginChooser() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 bg-brand-yellow rounded-2xl flex items-center justify-center text-2xl font-bold text-brand-ink shadow-md">
              S
            </div>
            <div className="text-left">
              <div className="text-3xl font-bold text-brand-ink">Sunstar HR</div>
              <div className="text-sm text-gray-500">Work Measurement Portal</div>
            </div>
          </div>
          <p className="text-gray-600 mt-4">Choose how you want to sign in</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Link
            to="/employee/login"
            className="group bg-white border-2 border-brand-yellow rounded-2xl p-8 hover:bg-brand-yellowSoft transition shadow-sm"
          >
            <div className="text-5xl mb-4">👷</div>
            <div className="text-2xl font-bold text-brand-ink mb-2">Employee</div>
            <div className="text-gray-600">Log your daily work on the tablet.</div>
            <div className="mt-6 text-brand-yellowDark font-semibold group-hover:underline">
              Enter as employee →
            </div>
          </Link>

          <Link
            to="/admin/login"
            className="group bg-brand-ink text-white rounded-2xl p-8 hover:bg-black transition shadow-sm"
          >
            <div className="text-5xl mb-4">📊</div>
            <div className="text-2xl font-bold mb-2">Admin</div>
            <div className="text-gray-300">View analytics, rates, and full history.</div>
            <div className="mt-6 text-brand-yellow font-semibold group-hover:underline">
              Enter as admin →
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
