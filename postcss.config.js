// Vite runs these over every stylesheet: Tailwind (see tailwind.config.js), then vendor prefixes for older browsers.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
