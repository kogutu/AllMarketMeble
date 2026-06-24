import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        allegro: {
          DEFAULT: "#FF5A00",
          dark: "#e04f00",
          light: "#ff7a2e",
        },
      },
    },
  },
  plugins: [],
};
export default config;
