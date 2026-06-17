<script lang="ts">
  /** Hello Kitty–inspired white cat face (original SVG, not official asset). */
</script>

<svg class="kitty-body" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="kittyFaceFill" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="85%" stop-color="#f8f4f4" />
      <stop offset="100%" stop-color="#efe8e8" />
    </radialGradient>
    <filter id="kittyGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  <g class="kitty-chubby">
    <!-- ears -->
    <path class="kitty-ear left" d="M28 52 L18 22 L42 38 Z" fill="url(#kittyFaceFill)" stroke="#e8d8d8" stroke-width="1.2" />
    <path class="kitty-ear right" d="M92 52 L102 22 L78 38 Z" fill="url(#kittyFaceFill)" stroke="#e8d8d8" stroke-width="1.2" />
    <path class="kitty-ear-inner left" d="M30 46 L24 30 L38 40 Z" fill="#ffd6e8" />
    <path class="kitty-ear-inner right" d="M90 46 L96 30 L82 40 Z" fill="#ffd6e8" />

    <!-- red bow (left ear) -->
    <g class="kitty-bow" transform="translate(14, 18)">
      <ellipse cx="14" cy="12" rx="11" ry="8" fill="#e60026" />
      <ellipse cx="32" cy="12" rx="11" ry="8" fill="#e60026" />
      <circle cx="23" cy="12" r="5.5" fill="#cc0020" />
      <circle cx="23" cy="12" r="2.2" fill="#ff4d6d" opacity="0.55" />
    </g>

    <!-- face -->
    <circle class="kitty-face" cx="60" cy="62" r="40" fill="url(#kittyFaceFill)" filter="url(#kittyGlow)" stroke="#f0e4e4" stroke-width="1.5" />
  </g>

  <g class="kitty-face-features">
    <ellipse class="eye left" cx="46" cy="58" rx="3.2" ry="4.2" />
    <ellipse class="eye right" cx="74" cy="58" rx="3.2" ry="4.2" />
    <circle class="eye-shine left" cx="47.2" cy="56.8" r="1.1" />
    <circle class="eye-shine right" cx="75.2" cy="56.8" r="1.1" />
    <ellipse class="kitty-nose" cx="60" cy="66" rx="4.5" ry="3.2" fill="#f4d03f" stroke="#e0b820" stroke-width="0.6" />
    <path class="whisker" d="M18 64 L38 62" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <path class="whisker" d="M18 70 L38 68" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <path class="whisker" d="M18 76 L38 74" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <path class="whisker" d="M102 64 L82 62" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <path class="whisker" d="M102 70 L82 68" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <path class="whisker" d="M102 76 L82 74" stroke="#c9b8b8" stroke-width="1.2" stroke-linecap="round" />
    <ellipse class="blush left" cx="38" cy="70" rx="7" ry="4.5" />
    <ellipse class="blush right" cx="82" cy="70" rx="7" ry="4.5" />
  </g>
</svg>
