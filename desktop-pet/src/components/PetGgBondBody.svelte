<script lang="ts">
  /** GG Bond–inspired superhero pig (original SVG, not official asset). */
</script>

<svg class="gg-body" viewBox="0 0 100 112" aria-hidden="true">
  <defs>
    <radialGradient id="ggSkin" cx="35%" cy="28%" r="72%">
      <stop offset="0%" stop-color="#FFE4EF" />
      <stop offset="45%" stop-color="#F8A8C0" />
      <stop offset="100%" stop-color="#D87898" />
    </radialGradient>
    <linearGradient id="ggArmor" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FF5058" />
      <stop offset="50%" stop-color="#E02030" />
      <stop offset="100%" stop-color="#A81828" />
    </linearGradient>
    <linearGradient id="ggHelmet" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FF6868" />
      <stop offset="100%" stop-color="#C82030" />
    </linearGradient>
    <radialGradient id="ggEmblem" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#FFE878" />
      <stop offset="100%" stop-color="#E0A820" />
    </radialGradient>
    <filter id="ggDrop" x="-18%" y="-15%" width="136%" height="145%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#4a1020" flood-opacity="0.28" />
    </filter>
  </defs>

  <g class="gg-chubby" filter="url(#ggDrop)">
    <ellipse class="gg-ground" cx="50" cy="106" rx="22" ry="3.2" fill="#3a1020" opacity="0.18" />

    <!-- back arm -->
    <ellipse class="gg-arm back" cx="18" cy="68" rx="6" ry="10" fill="url(#ggArmor)" transform="rotate(-22 18 68)" />

    <!-- armored body -->
    <path
      class="gg-torso"
      fill="url(#ggArmor)"
      d="M28 54 C38 50 62 50 72 54 L76 82 C50 88 24 82 24 82 Z"
    />
    <path class="gg-torso-shine" fill="#fff" opacity="0.14" d="M34 56 L58 56 L60 72 L32 74 Z" />

    <!-- gold belt -->
    <rect class="gg-belt" x="26" y="72" width="48" height="6" rx="2" fill="url(#ggEmblem)" />
    <!-- chest emblem -->
    <circle class="gg-emblem" cx="50" cy="64" r="9" fill="url(#ggEmblem)" />
    <path
      class="gg-emblem-mark"
      fill="#C88810"
      d="M50 58 L53 66 L46 62 L54 62 L47 66 Z"
    />

    <!-- legs -->
    <ellipse class="gg-foot left" cx="36" cy="94" rx="8" ry="5" fill="url(#ggArmor)" />
    <ellipse class="gg-foot right" cx="60" cy="94" rx="8" ry="5" fill="url(#ggArmor)" />

    <!-- pig head -->
    <circle class="gg-head" cx="50" cy="34" r="24" fill="url(#ggSkin)" />
    <ellipse class="gg-head-shine" cx="40" cy="24" rx="10" ry="6" fill="#fff" opacity="0.24" />

    <!-- red hero helmet -->
    <path
      class="gg-helmet"
      fill="url(#ggHelmet)"
      d="M26 20 C30 8 70 8 74 20 C76 28 74 34 68 36 L32 36 C26 34 24 28 26 20 Z"
    />
    <path class="gg-helmet-wing left" fill="url(#ggHelmet)" d="M22 24 L10 18 L14 30 Z" />
    <path class="gg-helmet-wing right" fill="url(#ggHelmet)" d="M78 24 L90 18 L86 30 Z" />
    <ellipse class="gg-helmet-shine" cx="50" cy="14" rx="14" ry="4" fill="#fff" opacity="0.2" />

    <!-- snout -->
    <ellipse class="gg-snout" cx="50" cy="42" rx="14" ry="10" fill="url(#ggSkin)" />
    <ellipse class="gg-nose" cx="50" cy="40" rx="6" ry="4.5" fill="#2a1820" />
    <ellipse class="gg-nose-shine" cx="48" cy="38.5" rx="2" ry="1.2" fill="#fff" opacity="0.35" />

    <!-- front arm -->
    <ellipse class="gg-arm front" cx="80" cy="66" rx="6" ry="10" fill="url(#ggArmor)" transform="rotate(18 80 66)" />
  </g>

  <g class="gg-face-features">
    <ellipse class="eye left" cx="40" cy="30" rx="4" ry="4.5" fill="#fff" />
    <circle class="pupil left" cx="40" cy="30" r="1.8" fill="#1a1018" />
    <circle class="eye-glint left" cx="41.2" cy="28.5" r="0.9" fill="#fff" />

    <ellipse class="eye right" cx="60" cy="30" rx="4" ry="4.5" fill="#fff" />
    <circle class="pupil right" cx="60" cy="30" r="1.8" fill="#1a1018" />
    <circle class="eye-glint right" cx="61.2" cy="28.5" r="0.9" fill="#fff" />

    <path
      class="mouth"
      fill="none"
      stroke="#3a2830"
      stroke-width="1.8"
      stroke-linecap="round"
      d="M44 48 Q50 52 56 48"
    />
  </g>
</svg>
