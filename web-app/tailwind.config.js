/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6', // blue-500
        secondary: '#64748b', // slate-500
        success: '#22c55e', // green-500
        warning: '#f59e0b', // amber-500
        danger: '#ef4444', // red-500
      }
    },
  },
  plugins: [],
}
