// svgo settings for the illustration sources (C11.1). Keep what the React
// wrapper and the stylesheet rely on: viewBox, classes, data-part hooks.
export default {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
    'removeDimensions',
  ],
};
