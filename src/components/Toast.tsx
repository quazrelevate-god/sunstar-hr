export type ToastKind = "success" | "error" | "info";

export function Toast({ msg, kind = "info" }: { msg: string; kind?: ToastKind }) {
  const style =
    kind === "success"
      ? "bg-green-600 text-white"
      : kind === "error"
      ? "bg-red-600 text-white"
      : "bg-brand-ink text-brand-yellow";
  const icon = kind === "success" ? "✓" : kind === "error" ? "✕" : "•";
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-[fadeInDown_.2s_ease-out]">
      <div className={`${style} px-5 py-3 rounded-full shadow-2xl font-medium flex items-center gap-2 max-w-[90vw]`}>
        <span className="text-lg leading-none">{icon}</span>
        <span className="truncate">{msg}</span>
      </div>
    </div>
  );
}
