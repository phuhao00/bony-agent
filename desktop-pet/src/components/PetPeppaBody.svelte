<script lang="ts">
  /** Peppa-inspired 3D plush doll (original SVG, not official asset). */
</script>

<svg class="peppa-body" viewBox="0 0 100 112" aria-hidden="true">
  <defs>
    <radialGradient id="peppaSkin" cx="28%" cy="22%" r="78%" gradientUnits="objectBoundingBox">
      <stop offset="0%" stop-color="#FFF0F6" />
      <stop offset="35%" stop-color="#F8B8CC" />
      <stop offset="100%" stop-color="#D8809A" />
    </radialGradient>
    <linearGradient id="peppaSnoutShade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FAD0E0" stop-opacity="0" />
      <stop offset="100%" stop-color="#B86880" stop-opacity="0.35" />
    </linearGradient>
    <linearGradient id="peppaDress" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FF7070" />
      <stop offset="45%" stop-color="#EF4444" />
      <stop offset="100%" stop-color="#B82830" />
    </linearGradient>
    <radialGradient id="peppaEye" cx="35%" cy="30%" r="65%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="100%" stop-color="#F0E8EC" />
    </radialGradient>
    <radialGradient id="peppaBlush" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FF98B0" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#E07088" stop-opacity="0.35" />
    </radialGradient>
    <filter id="peppaDrop" x="-20%" y="-15%" width="140%" height="145%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#4a1828" flood-opacity="0.28" />
    </filter>
    <filter id="peppaEyeShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0.6" stdDeviation="0.5" flood-color="#3a2030" flood-opacity="0.35" />
    </filter>
    <!-- shared head silhouette -->
    <path
      id="peppaHeadShape"
      d="
        M 84 32
        C 89 32 92 35 92 37.5
        C 92 40 89 43 84 43
        C 76 44 66 45 58 46
        C 50 54 38 58 26 58
        C 10 58 2 48 2 36
        C 2 22 14 10 30 10
        C 42 10 50 14 54 20
        C 58 26 66 28 74 28
        C 78 28 81 29 84 32
        Z
      "
    />
    <clipPath id="peppaHeadClip">
      <use href="#peppaHeadShape" />
    </clipPath>
  </defs>

  <g class="peppa-chubby" filter="url(#peppaDrop)">
    <ellipse class="peppa-ground" cx="48" cy="106" rx="22" ry="3.2" fill="#3a1828" opacity="0.2" />

    <!-- tail -->
    <path
      class="peppa-tail"
      fill="none"
      stroke="#E8A0B8"
      stroke-width="2.8"
      stroke-linecap="round"
      d="M16 72 C8 68 6 60 10 54 C13 50 8 46 12 42"
    />

    <g class="peppa-arm back" fill="none" stroke="#2a1820" stroke-width="2.2" stroke-linecap="round">
      <path d="M22 56 L8 62" />
      <path d="M8 62 L5 59" />
      <path d="M8 62 L5 62" />
      <path d="M8 62 L5 65" />
    </g>

    <!-- dress body -->
    <path class="peppa-dress" fill="url(#peppaDress)" d="M26 56 L62 56 L68 84 L20 84 Z" />
    <path
      class="peppa-dress-shine"
      fill="#fff"
      opacity="0.16"
      d="M30 58 L54 58 L56 72 L28 72 Z"
    />

    <g class="peppa-leg" fill="none" stroke="#2a1820" stroke-width="2.4" stroke-linecap="round">
      <path d="M34 84 L34 94" />
      <path d="M50 84 L50 94" />
    </g>
    <ellipse class="peppa-shoe" cx="34" cy="96" rx="5.5" ry="2.4" fill="#1a1018" />
    <ellipse class="peppa-shoe" cx="50" cy="96" rx="5.5" ry="2.4" fill="#1a1018" />

    <!-- ears -->
    <ellipse class="peppa-ear left" cx="24" cy="8" rx="4.5" ry="6.5" fill="url(#peppaSkin)" />
    <ellipse class="peppa-ear right" cx="38" cy="6" rx="4.5" ry="6.5" fill="url(#peppaSkin)" />

    <!-- plush white rim -->
    <use href="#peppaHeadShape" fill="none" stroke="#fff" stroke-width="3.2" opacity="0.65" />
    <!-- head volume -->
    <use href="#peppaHeadShape" class="peppa-head" fill="url(#peppaSkin)" />
    <!-- snout underside shade -->
    <path
      fill="url(#peppaSnoutShade)"
      clip-path="url(#peppaHeadClip)"
      d="M 54 36 L 90 36 L 90 43 L 84 43 C 76 44 66 45 58 46 L 54 43 Z"
    />
    <!-- soft specular (matte plush, not glossy plastic) -->
    <ellipse class="peppa-head-shine" cx="24" cy="18" rx="11" ry="7" fill="#fff" opacity="0.22" clip-path="url(#peppaHeadClip)" />
    <ellipse class="peppa-snout-shine" cx="72" cy="26" rx="7" ry="4" fill="#fff" opacity="0.18" clip-path="url(#peppaHeadClip)" />

    <!-- neck bridge -->
    <path class="peppa-neck" fill="url(#peppaSkin)" d="M24 54 C34 52 48 52 56 54 L56 58 C44 60 28 60 20 58 Z" />

    <g class="peppa-arm front" fill="none" stroke="#2a1820" stroke-width="2.2" stroke-linecap="round">
      <path d="M64 56 L78 62" />
      <path d="M78 62 L82 59" />
      <path d="M78 62 L82 62" />
      <path d="M78 62 L82 65" />
    </g>
  </g>

  <g class="peppa-face-features">
    <!-- 3/4 plush: both eyes on front, right slightly lower -->
    <ellipse
      class="eye left"
      cx="28"
      cy="30"
      rx="4.2"
      ry="4.5"
      fill="url(#peppaEye)"
      filter="url(#peppaEyeShadow)"
    />
    <circle class="pupil left" cx="27.2" cy="30" r="1.6" fill="#1a1018" />
    <circle class="eye-glint left" cx="29" cy="28.5" r="0.9" fill="#fff" />

    <ellipse
      class="eye right"
      cx="40"
      cy="32"
      rx="4.2"
      ry="4.5"
      fill="url(#peppaEye)"
      filter="url(#peppaEyeShadow)"
    />
    <circle class="pupil right" cx="39.2" cy="32" r="1.6" fill="#1a1018" />
    <circle class="eye-glint right" cx="41" cy="30.5" r="0.9" fill="#fff" />

    <circle class="blush" cx="18" cy="40" r="5.5" fill="url(#peppaBlush)" />

    <circle class="nostril" cx="88" cy="35" r="1.2" fill="#9a5068" />
    <circle class="nostril" cx="88" cy="39.5" r="1.2" fill="#9a5068" />

    <path
      class="mouth"
      fill="none"
      stroke="#3a2830"
      stroke-width="1.6"
      stroke-linecap="round"
      d="M22 46 Q32 50 42 46"
    />
  </g>
</svg>
