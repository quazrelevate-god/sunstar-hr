type Size = "xs" | "sm" | "md" | "lg";

const HEIGHT: Record<Size, string> = {
  xs: "h-6",
  sm: "h-10",
  md: "h-12",
  lg: "h-20",
};

export function Logo({ size = "sm", className = "" }: { size?: Size; className?: string }) {
  return (
    <img
      src="/sunstar-logo.png?v=2"
      alt="Sunstar"
      className={`${HEIGHT[size]} w-auto object-contain select-none ${className}`}
      draggable={false}
    />
  );
}
