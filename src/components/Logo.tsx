type Size = "xs" | "sm" | "md" | "lg";

const HEIGHT: Record<Size, string> = {
  xs: "h-6",
  sm: "h-9",
  md: "h-12",
  lg: "h-16",
};

export function Logo({ size = "sm", className = "" }: { size?: Size; className?: string }) {
  return (
    <img
      src="/sunstar-logo.png"
      alt="Sunstar"
      className={`${HEIGHT[size]} w-auto object-contain select-none ${className}`}
      draggable={false}
    />
  );
}
