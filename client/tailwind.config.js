/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#F6F3EA',
        forest: '#1F2A22',
        amber: {
          DEFAULT: '#F0B429',
          dark: '#D69E1E',
        },
        sage: '#8FBC8F',
      },
    },
  },
  plugins: [],
};
