/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#fff5f5',
          100: '#ffe0e0',
          200: '#ffbdbd',
          300: '#ff8a8a',
          400: '#ff4d4d',
          500: '#EE0000',
          600: '#CC0000',
          700: '#A30000',
          800: '#7D0000',
          900: '#5C0000',
          950: '#3D0000',
        },
      },
      fontFamily: {
        sans: ['"Red Hat Text"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Red Hat Display"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
