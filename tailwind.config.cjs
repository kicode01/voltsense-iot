/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        maroon: {
          50: '#f9f2f2',
          100: '#f4e5e5',
          200: '#e5cdcd',
          300: '#d1a8a8',
          400: '#b87c7c',
          500: '#a35757',
          600: '#8c4242',
          700: '#753636',
          800: '#612f2f',
          900: '#522929',
          950: '#2c1414',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      transitionTimingFunction: {
        'apple-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      animation: {
        'gradient-xy': 'gradient-xy 15s ease infinite',
        'ping-slow': 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      keyframes: {
        'gradient-xy': {
          '0%, 100%': {
            'background-size': '400% 400%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          }
        }
      }
    },
  },
  plugins: [
    require("tailwindcss-animate")
  ],
}
