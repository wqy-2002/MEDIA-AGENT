import type { Config } from 'tailwindcss';

// Tailwind CSS 配置，扫描所有入口与组件
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#3385ff',
          600: '#1f66f5',
          700: '#1751e1',
          800: '#1942b6',
          900: '#1a3c8f',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
