/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          // Primary blue palette (round 6 rebrand)
          blue:     "#2563EB", // Blue-600, primary action
          blueDark: "#1E40AF", // Blue-800, hover / contrast
          blueSoft: "#EFF6FF", // Blue-50, subtle backgrounds / chips
          ink:      "#0F172A", // Slate-900, richer than pure black against blue
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      boxShadow: {
        // Blue-tinted soft shadow for panels
        card: "0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(37 99 235 / 0.06)",
        raised: "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(37 99 235 / 0.06)",
      },
    },
  },
  plugins: [],
};
