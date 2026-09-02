// The entry has to sit inside the root this build declares.
//
// A `<script src>` pointing outside it is bundled correctly and served as the
// page itself in development: vite rewrites the path against the root, finds
// nothing, and falls back to the HTML — so the page loads, asks for its own
// script, is handed itself, and renders nothing. An import may cross the
// boundary; the tag may not.
import '../src/app/demo-main.tsx';
