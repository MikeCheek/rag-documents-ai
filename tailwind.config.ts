import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0C0F16",
          900: "#10141C",
          850: "#141926",
          800: "#171C27",
          700: "#1F2531",
          600: "#2A3140",
          500: "#3A4356",
        },
        paper: {
          100: "#F4F2ED",
          200: "#EAEAE3",
          300: "#C7C9CE",
          400: "#8B92A3",
        },
        brass: {
          300: "#E0BD7C",
          400: "#C99A4B",
          500: "#AD8038",
          600: "#8C6529",
        },
        teal: {
          400: "#6BA79C",
          500: "#4C8C82",
          600: "#3A6D65",
        },
        rust: {
          400: "#D57D6F",
          500: "#C1584B",
          600: "#9F433A",
        },
      },
      fontFamily: {
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jbmono)", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(0,0,0,0.4)",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.2" },
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slidein: {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        blink: "blink 1.4s ease-in-out infinite",
        rise: "rise 0.35s ease-out",
        slidein: "slidein 0.25s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
