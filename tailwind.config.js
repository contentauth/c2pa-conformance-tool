import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts,jsx,tsx}'],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        // Override gray with neutral so dark mode backgrounds have no blue tint
        gray: colors.neutral,
        'ca-blue': {
          50: '#E6F2FF',
          100: '#CCE5FF',
          200: '#99CCFF',
          300: '#66B2FF',
          400: '#3399FF',
          500: '#0066CC',
          600: '#0052A3',
          700: '#003D7A',
          800: '#002952',
          900: '#001429',
          DEFAULT: '#0066CC',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
