# Ball pour prototype

A standalone test of a possible new core for Chaos Engine: real physics (Matter.js 0.19.0), 100 balls,
place ramps / a spring pad / a bumper / a fan, score = balls caught in the bucket. Three hand-made levels.
Synthesised sound (Web Audio), sprites from `src/client/assets` (Kenney, CC0).

Open `pour.html` through any static server (it loads Matter.js from cdnjs). `window.__pour(level, pieces, seed)`
runs a pour headlessly and returns the score; star targets per level were set from hill-climbed builds.
