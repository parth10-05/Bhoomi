import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                eco: {
                    bg: '#0a0f0a',
                    panel: 'rgba(10, 15, 10, 0.85)',
                    border: 'rgba(255, 255, 255, 0.08)',
                    green: '#4ade80',
                    amber: '#f59e0b',
                    red: '#ef4444',
                    blue: '#3b82f6',
                    text: '#e5e7eb',
                    muted: '#6b7280',
                },
            },
            fontFamily: {
                heading: ['"Space Grotesk"', 'sans-serif'],
                body: ['"Inter"', 'sans-serif'],
            },
        },
    },
    plugins: [forms],
};
